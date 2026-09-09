// Google Maps Platform：Places（评分）+ Geocoding（地址→坐标）。
// ADR-004 / ADR-007。只在 Edge Function 用，key 绝不进客户端。
//
// 【硬约束】Cloud Console 已设每日配额上限（Places / Geocoding 各自）。
// 这里再加一道**进程内当日调用计数**作第二保险 —— Cloud 配额有延迟，
// 且防止配置遗漏。计数超限直接不发请求，功能降级（评分回落合成人气分，
// 地理编码回落报错让前端提示）。
//
// 缓存：进程内 Map + TTL。生产环境（Edge Function 多实例）应换成 Deno KV /
// Supabase 短 TTL 缓存表；评分是 Google 的数据，按 ≤24h 处理，不长期落库。

import { haversineM } from "./reach.ts";

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const TEXTSEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 进程内当日调用硬上限（第二道保险，比 Cloud 配额留点余量）。 */
const DEFAULT_DAILY_CAP = 120;

export interface GoogleConfig {
  key?: string;
  dailyCap?: number;
  /** 注入 fetch，测试用 */
  fetchImpl?: typeof fetch;
}

export interface PlaceRating {
  rating: number;
  userRatingCount: number;
  placeId: string;
  mapsUri: string;
}

export interface GeoResult {
  lat: number;
  lng: number;
  formatted: string;
}

// ---------- 当日计数熔断 ----------

let counterDay = "";
const counters: Record<string, number> = {};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function tryConsume(bucket: string, cap: number): boolean {
  const d = today();
  if (d !== counterDay) {
    counterDay = d;
    for (const k of Object.keys(counters)) delete counters[k];
  }
  const used = counters[bucket] ?? 0;
  if (used >= cap) return false;
  counters[bucket] = used + 1;
  return true;
}

/** 测试 / 监控用 */
export function _googleCounters(): Record<string, number> {
  return { day: counterDay as unknown as number, ...counters };
}
export function _resetGoogle(): void {
  counterDay = "";
  for (const k of Object.keys(counters)) delete counters[k];
  cache.clear();
}

// ---------- 缓存 ----------

const cache = new Map<string, { at: number; value: unknown }>();

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}
function cacheSet(key: string, value: unknown): void {
  cache.set(key, { at: Date.now(), value });
}

// ---------- 客户端 ----------

export interface GoogleClient {
  enabled: boolean;
  /** 地址 → 坐标。配额用尽 / 未配置返回 null。 */
  geocode(address: string): Promise<GeoResult | null>;
  /** 一批店按 名称+坐标 补评分。命中不了或配额用尽的条目不在返回 Map 里。 */
  ratingsFor(
    shops: Array<{ id: string; name: string; lat: number; lng: number }>,
  ): Promise<Map<string, PlaceRating>>;
}

export function createGoogle(cfg: GoogleConfig): GoogleClient {
  const key = cfg.key?.trim();
  const cap = cfg.dailyCap ?? DEFAULT_DAILY_CAP;
  const doFetch = cfg.fetchImpl ?? fetch;

  if (!key) {
    return {
      enabled: false,
      geocode: () => Promise.resolve(null),
      ratingsFor: () => Promise.resolve(new Map()),
    };
  }

  async function geocode(address: string): Promise<GeoResult | null> {
    const addr = address.trim();
    if (!addr) return null;
    const ck = "geo:" + addr;
    const cached = cacheGet<GeoResult | null>(ck);
    if (cached !== undefined) return cached;
    if (!tryConsume("geocode", cap)) {
      console.error("Google Geocoding 当日计数已达上限，降级");
      return null;
    }
    const u = new URL(GEOCODE_URL);
    u.searchParams.set("address", addr);
    u.searchParams.set("key", key!);
    u.searchParams.set("language", "ja");
    u.searchParams.set("region", "jp");
    u.searchParams.set("components", "country:JP");
    try {
      const res = await doFetch(u);
      const json = await res.json();
      if (json.status !== "OK" || !json.results?.length) {
        cacheSet(ck, null);
        return null;
      }
      const r = json.results[0];
      const out: GeoResult = {
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        formatted: r.formatted_address ?? addr,
      };
      cacheSet(ck, out);
      return out;
    } catch (err) {
      console.error("Google Geocoding 失败:", (err as Error).message);
      return null;
    }
  }

  async function ratingsFor(
    shops: Array<{ id: string; name: string; lat: number; lng: number }>,
  ): Promise<Map<string, PlaceRating>> {
    const out = new Map<string, PlaceRating>();
    for (const shop of shops) {
      const ck = "rate:" + shop.id;
      const cached = cacheGet<PlaceRating | null>(ck);
      if (cached !== undefined) {
        if (cached) out.set(shop.id, cached);
        continue;
      }
      if (!tryConsume("places", cap)) {
        console.error("Google Places 当日计数已达上限，其余店降级");
        break;
      }
      const rating = await textSearchRating(shop);
      cacheSet(ck, rating);
      if (rating) out.set(shop.id, rating);
    }
    return out;
  }

  async function textSearchRating(shop: {
    name: string;
    lat: number;
    lng: number;
  }): Promise<PlaceRating | null> {
    try {
      const res = await doFetch(TEXTSEARCH_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": key!,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.googleMapsUri",
        },
        body: JSON.stringify({
          textQuery: shop.name,
          languageCode: "ja",
          regionCode: "JP",
          maxResultCount: 3,
          locationBias: {
            circle: {
              center: { latitude: shop.lat, longitude: shop.lng },
              radius: 400,
            },
          },
        }),
      });
      if (!res.ok) {
        console.error("Places searchText", res.status);
        return null;
      }
      const json = await res.json();
      const places: any[] = json.places ?? [];
      // 选距离最近且在 250m 内的
      let best: any = null;
      let bestD = Infinity;
      for (const p of places) {
        if (!p.location) continue;
        const d = haversineM(
          shop.lat,
          shop.lng,
          p.location.latitude,
          p.location.longitude,
        );
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (!best || bestD > 250 || best.rating == null) return null;
      return {
        rating: best.rating,
        userRatingCount: best.userRatingCount ?? 0,
        placeId: best.id,
        mapsUri: best.googleMapsUri ?? "",
      };
    } catch (err) {
      console.error("Places searchText 失败:", (err as Error).message);
      return null;
    }
  }

  return { enabled: true, geocode, ratingsFor };
}
