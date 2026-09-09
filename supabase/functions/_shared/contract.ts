// /search 的请求 / 响应契约。
// 前端只认这个形状，本地 mock 和真实 HotPepper 走同一条管道产出同一形状。
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
  party: number;
  /** HotPepper genre code 列表，空数组＝不限 */
  genres: string[];
  budgetMin: number;
  budgetMax: number;
  /** 要排除的 shop id（「只看没吃过的」） */
  exclude?: string[];
  /** 要排除的 shop id（用户标了「不喜欢」） */
  disliked?: string[];
  /** 分批页码，0 起，每批 5 家 */
  batch?: number;
}

export interface HoursInfo {
  status: "ok" | "partial" | "failed";
  /** 目标那天的营业时段，例 "17:00–23:30"；解析不出为 null */
  todayLabel: string | null;
  /** 目标那天的料理 L.O.（分钟，从 0:00 起，可 >1440） */
  lastOrderMin: number | null;
  lastOrderLabel: string | null;
  /** 到店时刻是否落在营业时段内；"unknown" 表示未能判断（已降级为不过滤） */
  openAtTarget: boolean | "unknown";
  /** true 时 UI 需标注「营业时间请以店家为准」 */
  disclaimer: boolean;
}

export interface ShopResult {
  id: string;
  name: string;
  genre: { code: string; name: string };
  /** mobile_access，比 access 短，适合卡片 */
  station: string;
  access: string;
  lat: number;
  lng: number;
  distanceM: number;
  etaMinutes: number;
  budget: { code: string; name: string; average: string; mid: number };
  photo: { s: string; m: string; l: string } | null;
  /** urls.pc，含 vos= 追踪参数，原样透传，不得改写 */
  url: string;
  card: boolean;
  nonSmoking: "full" | "partial" | "none" | "unknown";
  /** party_capacity：宴会最大人数，0 表示无数据 */
  partyCapacity: number;
  /** capacity：总席数（和 party_capacity 不是一回事） */
  seats: number;
  privateRoom: { available: boolean; detail: string } | null;
  coupon: boolean;
  catch: string;
  hours: HoursInfo;
  /**
   * 合成「人气」分 0..1。用照片数 / 有无套餐 / 有无优惠券 合成，
   * 供打分公式的「人气」项使用（对全部候选统一，保证排序公平）。
   */
  popularity: number;
  /**
   * Google Places 评分（ADR-004）。只对**返回的这一批**补充，命中不了 / 配额用尽为 null。
   * 目前只用于展示，不参与排序（要参与排序得给全部候选打分，见 roadmap「打分调优」）。
   */
  rating: number | null;
  userRatingCount: number | null;
  ratingSource: "google" | null;
  googleMapsUri: string | null;
  score: number;
  /** 各打分项的加权前原始值 0..1 */
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
  /** 归一化后的请求回显，便于前端核对 */
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
    capacity: number;
    budget: number;
    genre: number;
    excluded: number;
    disliked: number;
  };
  attribution: { text: string; url: string };
  /** 管道层面的提示，例：「3 家营业时间无法解析，已按不过滤处理」 */
  notes: string[];
  /** 数据来源：mock（演示数据）或 hotpepper（真实） */
  source: "mock" | "hotpepper";
}

export const ATTRIBUTION = {
  text: "Powered by ホットペッパーグルメ",
  url: "http://webservice.recruit.co.jp/",
} as const;
