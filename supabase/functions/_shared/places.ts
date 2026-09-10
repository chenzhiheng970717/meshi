// Google Places API (New) — 店铺数据源（ADR-008，取代 HotPepper）。
//
// 用 Nearby Search：一次调用返回最多 20 家，带 priceRange / rating / 营业时间 /
// 分类 / 照片，distance 排序。没有翻页，但对「从车站步行」的场景 20 家够用；
// 大半径时用 DISTANCE + POPULARITY 两次调用凑候选池。
//
// key 只在 Edge Function，绝不进前端。两道熔断见 google.ts（配额 + 进程内计数）。

import { haversineM } from "./reach.ts";
import type { GoogleOpeningHours } from "./googleHours.ts";

const NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.location",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.priceRange",
  "places.priceLevel",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours",
  "places.currentOpeningHours",
  "places.googleMapsUri",
  "places.reservable",
  "places.photos",
  "places.businessStatus",
].join(",");

/** 前端 genre 码 → Google includedTypes（宽匹配，pipeline 再按 primaryType 打分） */
export const GENRE_TYPES: Record<string, string[]> = {
  G001: ["japanese_izakaya_restaurant", "bar", "pub", "bar_and_grill"],
  G004: ["japanese_restaurant", "sushi_restaurant", "tempura_restaurant"],
  G013: ["ramen_restaurant"],
  G008: ["yakiniku_restaurant", "barbecue_restaurant"],
  G007: ["chinese_restaurant"],
  G006: ["italian_restaurant", "french_restaurant", "pizza_restaurant"],
  G005: ["american_restaurant", "hamburger_restaurant", "diner"],
  G017: ["korean_restaurant"],
  G009: [
    "thai_restaurant",
    "vietnamese_restaurant",
    "indian_restaurant",
    "asian_restaurant",
    "indonesian_restaurant",
  ],
  G014: ["cafe", "coffee_shop", "dessert_shop", "ice_cream_shop", "tea_house"],
};
// 不限口味时：以「吃饭」为主，纯酒吧 / 夜店不进（居酒屋另算，能吃）
const BROAD_TYPES = [
  "restaurant",
  "japanese_izakaya_restaurant",
  "cafe",
  "meal_takeaway",
];

const FOODISH =
  /restaurant|_bar$|^bar$|cafe|coffee|bakery|bistro|diner|pub|deli|izakaya|eatery|food/i;

export interface PriceRange {
  lo: number;
  hi: number;
}
export interface Candidate {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  primaryType: string;
  primaryTypeLabel: string;
  types: string[];
  priceRange: PriceRange | null;
  priceLevel: string | null;
  rating: number | null;
  userRatingCount: number | null;
  hours: GoogleOpeningHours | null;
  currentHours: GoogleOpeningHours | null;
  mapsUri: string;
  reservable: boolean | null;
  photoName: string | null;
}

export interface PlacesQuery {
  lat: number;
  lng: number;
  radiusM: number;
  genres: string[];
}

export interface PlacesClient {
  source: "google" | "mock";
  search(q: PlacesQuery): Promise<Candidate[]>;
}

export function createPlaces(env: {
  GOOGLE_PLACES_API_KEY?: string;
  mockCandidates?: Candidate[];
  fetchImpl?: typeof fetch;
  dailyCap?: number;
}): PlacesClient {
  const key = env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) {
    const mock = env.mockCandidates ?? [];
    return {
      source: "mock",
      search: (q) =>
        Promise.resolve(
          mock.filter((c) => haversineM(q.lat, q.lng, c.lat, c.lng) <= q.radiusM),
        ),
    };
  }
  return new GooglePlaces(key, env.fetchImpl ?? fetch, env.dailyCap ?? 60);
}

// ---- 进程内当日计数（第二道熔断，和 google.ts 各自算）----
let day = "";
let count = 0;
function consume(cap: number): boolean {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) {
    day = d;
    count = 0;
  }
  if (count >= cap) return false;
  count++;
  return true;
}
export function _resetPlaces() {
  day = "";
  count = 0;
}

class GooglePlaces implements PlacesClient {
  source = "google" as const;
  private key: string;
  private doFetch: typeof fetch;
  private cap: number;
  constructor(key: string, doFetch: typeof fetch, cap: number) {
    this.key = key;
    this.doFetch = doFetch;
    this.cap = cap;
  }

  async search(q: PlacesQuery): Promise<Candidate[]> {
    const types = q.genres.length
      ? [...new Set(q.genres.flatMap((g) => GENRE_TYPES[g] ?? []))]
      : BROAD_TYPES;
    const radius = Math.min(50000, Math.max(50, q.radiusM));
    // 小半径一次（按距离）；大半径再补一次按人气，拓宽候选面
    const ranks = radius > 2000 ? ["DISTANCE", "POPULARITY"] : ["DISTANCE"];

    const byId = new Map<string, Candidate>();
    for (const rank of ranks) {
      if (!consume(this.cap)) {
        console.error("Google Places 当日计数已达上限，用已有候选");
        break;
      }
      const body = {
        includedTypes: types.slice(0, 50),
        maxResultCount: 20,
        rankPreference: rank,
        languageCode: "ja",
        regionCode: "JP",
        locationRestriction: {
          circle: {
            center: { latitude: q.lat, longitude: q.lng },
            radius,
          },
        },
      };
      let json: any;
      try {
        const res = await this.doFetch(NEARBY_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Goog-Api-Key": this.key,
            "X-Goog-FieldMask": FIELD_MASK,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          console.error("searchNearby", res.status, (await res.text()).slice(0, 200));
          continue;
        }
        json = await res.json();
      } catch (err) {
        console.error("searchNearby 失败:", (err as Error).message);
        continue;
      }
      for (const p of json.places ?? []) {
        const c = toCandidate(p);
        if (c && isFoodish(c)) byId.set(c.id, c);
      }
    }
    return [...byId.values()];
  }
}

function isFoodish(c: Candidate): boolean {
  if (FOODISH.test(c.primaryType)) return true;
  return c.types.some((t) => FOODISH.test(t));
}

function priceRange(pr: any): PriceRange | null {
  if (!pr) return null;
  const lo = Number(pr.startPrice?.units ?? NaN);
  const hi = Number(pr.endPrice?.units ?? NaN);
  if (Number.isFinite(lo) && Number.isFinite(hi)) return { lo, hi };
  if (Number.isFinite(lo)) return { lo, hi: Math.round(lo * 1.6) }; // 只有下界
  if (Number.isFinite(hi)) return { lo: 0, hi };
  return null;
}

// deno-lint-ignore no-explicit-any
export function toCandidate(p: any): Candidate | null {
  if (!p?.id || !p?.location) return null;
  return {
    id: p.id,
    name: p.displayName?.text ?? "",
    address: p.shortFormattedAddress ?? p.formattedAddress ?? "",
    lat: p.location.latitude,
    lng: p.location.longitude,
    primaryType: p.primaryType ?? "",
    primaryTypeLabel: p.primaryTypeDisplayName?.text ?? "",
    types: p.types ?? [],
    priceRange: priceRange(p.priceRange),
    priceLevel: p.priceLevel ?? null,
    rating: typeof p.rating === "number" ? p.rating : null,
    userRatingCount: typeof p.userRatingCount === "number"
      ? p.userRatingCount
      : null,
    hours: p.regularOpeningHours ?? null,
    currentHours: p.currentOpeningHours ?? null,
    mapsUri: p.googleMapsUri ?? "",
    reservable: typeof p.reservable === "boolean" ? p.reservable : null,
    photoName: p.photos?.[0]?.name ?? null,
  };
}
