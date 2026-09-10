// Google Maps Platform：Geocoding（地址↔坐标）+ Place Photo（照片 URI 解析）。
// 店铺搜索在 places.ts。ADR-007 / ADR-008。key 绝不进客户端。
//
// 【硬约束】Cloud Console 已设每日配额上限。这里再加一道进程内当日计数作第二保险
// —— Cloud 配额有延迟，且防配置遗漏。超限直接不发请求，功能降级。
//
// 缓存：进程内 Map + TTL。多实例环境应换 Deno KV / Supabase 短 TTL 表。

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_CAP = 200;

export interface GoogleConfig {
  key?: string;
  dailyCap?: number;
  fetchImpl?: typeof fetch;
}

export interface GeoResult {
  lat: number;
  lng: number;
  formatted: string;
}

// ---------- 当日计数熔断 ----------
let counterDay = "";
const counters: Record<string, number> = {};

function tryConsume(bucket: string, cap: number): boolean {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== counterDay) {
    counterDay = d;
    for (const k of Object.keys(counters)) delete counters[k];
  }
  if ((counters[bucket] ?? 0) >= cap) return false;
  counters[bucket] = (counters[bucket] ?? 0) + 1;
  return true;
}
export function _googleCounters(): Record<string, number> {
  return { ...counters };
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
  geocode(address: string): Promise<GeoResult | null>;
  reverseGeocode(lat: number, lng: number): Promise<GeoResult | null>;
  /** photos[].name → 可直接 <img src> 的 CDN URL。配额用尽 / 失败返回 null。 */
  resolvePhoto(name: string, maxWidthPx?: number): Promise<string | null>;
}

export function createGoogle(cfg: GoogleConfig): GoogleClient {
  const key = cfg.key?.trim();
  const cap = cfg.dailyCap ?? DEFAULT_DAILY_CAP;
  const doFetch = cfg.fetchImpl ?? fetch;

  if (!key) {
    return {
      enabled: false,
      geocode: () => Promise.resolve(null),
      reverseGeocode: () => Promise.resolve(null),
      resolvePhoto: () => Promise.resolve(null),
    };
  }

  async function geo(params: URLSearchParams, ck: string): Promise<GeoResult | null> {
    const cached = cacheGet<GeoResult | null>(ck);
    if (cached !== undefined) return cached;
    if (!tryConsume("geocode", cap)) {
      console.error("Google Geocoding 当日计数达上限，降级");
      return null;
    }
    const u = new URL(GEOCODE_URL);
    params.forEach((v, k) => u.searchParams.set(k, v));
    u.searchParams.set("key", key!);
    u.searchParams.set("language", "ja");
    try {
      const json = await (await doFetch(u)).json();
      const r = (json.results ?? [])[0];
      if (json.status !== "OK" || !r) {
        cacheSet(ck, null);
        return null;
      }
      const out: GeoResult = {
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        formatted: r.formatted_address ?? "",
      };
      cacheSet(ck, out);
      return out;
    } catch (err) {
      console.error("Geocoding 失败:", (err as Error).message);
      return null;
    }
  }

  function geocode(address: string): Promise<GeoResult | null> {
    const addr = address.trim();
    if (!addr) return Promise.resolve(null);
    return geo(
      new URLSearchParams({ address: addr, region: "jp", components: "country:JP" }),
      "geo:" + addr,
    );
  }

  function reverseGeocode(lat: number, lng: number): Promise<GeoResult | null> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Promise.resolve(null);
    return geo(
      new URLSearchParams({
        latlng: `${lat},${lng}`,
        result_type: "street_address|premise|subpremise|route",
      }),
      `rev:${lat.toFixed(4)},${lng.toFixed(4)}`,
    );
  }

  async function resolvePhoto(
    name: string,
    maxWidthPx = 800,
  ): Promise<string | null> {
    if (!name) return null;
    const ck = `photo:${name}:${maxWidthPx}`;
    const cached = cacheGet<string | null>(ck);
    if (cached !== undefined) return cached;
    if (!tryConsume("photo", cap)) {
      console.error("Google Photo 当日计数达上限，降级");
      return null;
    }
    try {
      const u = new URL(`https://places.googleapis.com/v1/${name}/media`);
      u.searchParams.set("key", key!);
      u.searchParams.set("maxWidthPx", String(maxWidthPx));
      u.searchParams.set("skipHttpRedirect", "true");
      const json = await (await doFetch(u)).json();
      const uri = json?.photoUri ?? null;
      cacheSet(ck, uri);
      return uri;
    } catch (err) {
      console.error("Photo 解析失败:", (err as Error).message);
      return null;
    }
  }

  return { enabled: true, geocode, reverseGeocode, resolvePhoto };
}
