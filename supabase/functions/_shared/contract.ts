// /search 的请求 / 响应契约。
// 前端只认这个形状。数据源是 Google Places (New)（ADR-008），mock 走同一形状。
// 详细说明见 docs/contract.md。

export type Transport = "walk" | "bike" | "train" | "car";

export interface SearchRequest {
  /** 出发地经纬度。前端负责地理编码，服务端只吃坐标。 */
  origin: { lat: number; lng: number; label?: string };
  /** 就餐时刻，本地时间 ISO，无时区，例：2026-09-10T19:00 */
  datetime: string;
  transport: Transport;
  /** 可接受路程时长（分钟） */
  maxMinutes: number;
  /** 人数。不再硬过滤（Google 无 party_capacity），仅用于推荐理由 / 场景分 */
  party: number;
  /** 前端 genre 码列表（G001…），空数组＝不限。服务端映射到 Google type */
  genres: string[];
  budgetMin: number;
  budgetMax: number;
  /** 要排除的 place id（「只看没吃过的」） */
  exclude?: string[];
  /** 要排除的 place id（用户标了「不喜欢」） */
  disliked?: string[];
  /** 分批页码，0 起，每批 5 家 */
  batch?: number;
}

export interface HoursInfo {
  /** 目标那天的营业时段，例 "17:00–翌01:00"；无数据为 null */
  todayLabel: string | null;
  /** 打烊时刻（分钟，从 0:00 起，可 >1440） */
  closeMin: number | null;
  closeLabel: string | null;
  /** 建议最晚到店（打烊前留 45 分钟余量） */
  lastArrivalLabel: string | null;
  /** 到店时刻是否落在营业时段内；"unknown" ＝ 无营业时间数据（不过滤） */
  openAtTarget: boolean | "unknown";
  /** true 时 UI 标注「营业时间以店家为准」 */
  disclaimer: boolean;
}

export interface ShopResult {
  /** Google place id */
  id: string;
  name: string;
  /** Google 分类：type（`ramen_restaurant`）+ 本地化标签（「ラーメン」） */
  genre: { type: string; label: string };
  /** 短地址（区+町），Google shortFormattedAddress 收拾过 */
  address: string;
  lat: number;
  lng: number;
  distanceM: number;
  etaMinutes: number;
  /** 人均区间（円）。Google priceRange；无数据为 null */
  budget: { lo: number; hi: number; level: string | null } | null;
  /** 已解析的照片 URL（只对返回的这批解析）；photoName 供抽屉懒解析 */
  photo: { url: string } | null;
  photoName: string | null;
  /** Google Maps 店铺页 */
  url: string;
  rating: number | null;
  userRatingCount: number | null;
  reservable: boolean | null;
  hours: HoursInfo;
  /** 人气分 0..1：有 Google 评分用评分算，没有用合成兜底 */
  popularity: number;
  score: number;
  scoreBreakdown: {
    distance: number;
    genre: number;
    popularity: number;
    budget: number;
    scene: number;
  };
  /** 推荐理由碎片，前端用「·」拼接 */
  why: string[];
}

export interface SearchResponse {
  request: SearchRequest & { datetime: string };
  reach: { radiusM: number; formula: string };
  /** 通过硬过滤的总数 */
  total: number;
  batch: number;
  batches: number;
  results: ShopResult[];
  rejected: {
    distance: number;
    hours: number;
    budget: number;
    genre: number;
    excluded: number;
    disliked: number;
    notFood: number;
  };
  attribution: { text: string; url: string };
  notes: string[];
  /** google（真实）或 mock（演示数据） */
  source: "google" | "mock";
}

export const ATTRIBUTION = {
  text: "Powered by Google",
  url: "https://www.google.com/maps",
} as const;
