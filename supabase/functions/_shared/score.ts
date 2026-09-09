// 硬过滤 + 加权打分。
// 权重与半径参数都在这里，改打分逻辑不用动前端、不用发版。见 CLAUDE.md「推荐算法」。

import type { ShopResult, Transport } from "./contract.ts";
import type { RawShop } from "./hotpepper.ts";
import { budgetOverlaps, parseBudgetName } from "./budget.ts";
import { etaMinutes, haversineM } from "./reach.ts";
import { evaluateOpen, parseClose, parseOpen } from "./openHours.ts";
import { synthPopularity } from "./popularity.ts";

export const SCORE_WEIGHTS = {
  distance: 0.30,
  genre: 0.25,
  popularity: 0.20,
  budget: 0.15,
  scene: 0.10,
};

/** 料理 L.O. 提前余量（分钟）。见 CLAUDE.md 硬过滤。 */
export const LO_MARGIN_MIN = 60;

export interface ScoreContext {
  originLat: number;
  originLng: number;
  transport: Transport;
  maxMinutes: number;
  party: number;
  genres: string[];
  budgetMin: number;
  budgetMax: number;
  when: Date;
  timeMin: number;
}

export type RejectReason =
  | "distance"
  | "hours"
  | "capacity"
  | "budget"
  | "genre";

export interface ScoredShop {
  result: ShopResult;
  /** 排序用的最终分 */
  score: number;
}

/** Google 评分 → 人气分 0..1。3.0 星 → 0，4.5 星 → 满；评论数取对数拉平。 */
export function ratingToPopularity(rating: number, count: number): number {
  const quality = (rating - 3.0) / 1.5;
  const volume = Math.min(1, Math.log10(count + 1) / 3.5);
  return clamp01(0.6 * quality + 0.4 * volume);
}

/** 用 Google 评分重算一个候选的人气项和总分（原地）。 */
export function applyGoogleRating(
  s: ScoredShop,
  rating: { rating: number; userRatingCount: number },
): void {
  const pop = ratingToPopularity(rating.rating, rating.userRatingCount);
  const bd = s.result.scoreBreakdown;
  bd.popularity = Number(pop.toFixed(3));
  s.result.popularity = pop;
  const score = SCORE_WEIGHTS.distance * bd.distance +
    SCORE_WEIGHTS.genre * bd.genre +
    SCORE_WEIGHTS.popularity * bd.popularity +
    SCORE_WEIGHTS.budget * bd.budget +
    SCORE_WEIGHTS.scene * bd.scene;
  s.result.score = Number(score.toFixed(4));
  s.score = score;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function parseCapacity(v: number | string): number {
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parsePrefix(field: string | undefined): { available: boolean; detail: string } | null {
  if (!field) return null;
  const [head, ...rest] = field.split("：");
  const available = /あり|可|有/.test(head) && !/なし|不可|無/.test(head);
  // detail 是店家自由文本，原样保留（去掉换行和「※…」注意事项），展示交给前端
  const detail = rest.join("：").replace(/[\r\n]+/g, " ").split("※")[0].trim();
  return { available, detail };
}

/**
 * 卡片上的车站信息。mobile_access 通常是「新宿駅東口 徒歩3分」，
 * 但有些店塞了一整句广告文案。太长或不含「駅/徒歩/分」就退回 station_name。
 */
function cleanStation(shop: RawShop): string {
  const ma = (shop.mobile_access ?? "").trim();
  const looksClean = ma.length > 0 && ma.length <= 22 &&
    /駅|徒歩|分|より|から/.test(ma);
  if (looksClean) return ma;
  const st = (shop.station_name ?? "").trim();
  if (st) return /駅$/.test(st) ? st : st + "駅";
  return ma.slice(0, 22);
}

function nonSmokingState(v: string | undefined): ShopResult["nonSmoking"] {
  if (!v) return "unknown";
  if (v.includes("全面禁煙")) return "full";
  if (v.includes("一部禁煙")) return "partial";
  if (v.includes("禁煙席なし") || v.includes("喫煙可")) return "none";
  return "unknown";
}

/**
 * 对单个候选店做硬过滤 + 打分。
 * 通过返回 { result, score }；被过滤返回 { reject }。
 */
export function scoreShop(
  shop: RawShop,
  ctx: ScoreContext,
): { scored: ScoredShop } | { reject: RejectReason } {
  const distanceM = haversineM(ctx.originLat, ctx.originLng, shop.lat, shop.lng);

  // --- 硬过滤 ---
  // 半径由可达时长换算，等价于 eta > maxMinutes；见 reach.reachRadiusM
  const eta = etaMinutes(ctx.transport, distanceM);
  if (eta > ctx.maxMinutes) return { reject: "distance" };

  const cap = parseCapacity(shop.party_capacity);
  if (ctx.party > 0 && cap > 0 && cap < ctx.party) return { reject: "capacity" };

  const bud = parseBudgetName(shop.budget?.name);
  if (bud && !budgetOverlaps(bud, ctx.budgetMin, ctx.budgetMax)) {
    return { reject: "budget" };
  }

  // 口味不做硬过滤：HotPepper 的 genre 参数本身是宽匹配（会带出「兼营韩餐的
  // 烤肉店」这类），gather 已按参数拉过。这里只在打分时区分「主分类命中」和
  // 「通过关联分类命中」。mock 客户端在 gather 里已按 genre.code 严格筛。
  const genreHit = !ctx.genres.length
    ? "none"
    : ctx.genres.includes(shop.genre?.code)
    ? "primary"
    : ctx.genres.includes(shop.sub_genre?.code ?? "")
    ? "sub"
    : "loose";

  // 定休日：close 字段里明确的每周定休直接挡掉（不含「不定休 / 第N週」）
  const targetWeekday = (ctx.when.getDay() + 6) % 7;
  const closeInfo = parseClose(shop.close);
  if (closeInfo.closedWeekdays.includes(targetWeekday)) return { reject: "hours" };

  const parsedOpen = parseOpen(shop.open);
  const oh = evaluateOpen(parsedOpen, ctx.when, ctx.timeMin, LO_MARGIN_MIN);
  // openAtTarget === false 且能确定 → 过滤；"unknown" → 放行并标注
  if (oh.openAtTarget === false) return { reject: "hours" };
  // 「营业时间以店家为准」只针对营业时间解析可信度，不含定休日。
  // 不定休（日本很常见，约 1/6 的店）不在这里标红。
  const hoursDisclaimer = oh.openAtTarget === "unknown" ||
    parsedOpen.status !== "ok";

  // --- 加权打分 ---
  const popularity = synthPopularity(shop);
  const reqMid = (ctx.budgetMin + ctx.budgetMax) / 2;
  const reqSpan = Math.max(1, (ctx.budgetMax - ctx.budgetMin) / 2);

  const room = parsePrefix(shop.private_room);
  const hasCourse = shop.course === "あり";
  const smoke = nonSmokingState(shop.non_smoking);

  const genreScore = { none: 0.6, primary: 1, sub: 0.9, loose: 0.72 }[genreHit];
  const breakdown = {
    distance: clamp01(1 - eta / Math.max(1, ctx.maxMinutes)),
    genre: genreScore,
    popularity,
    budget: bud ? clamp01(1 - Math.abs(bud.mid - reqMid) / reqSpan) : 0.5,
    scene: clamp01(
      0.55 +
        (room?.available && ctx.party >= 4 ? 0.3 : 0) +
        (hasCourse && ctx.party >= 4 ? 0.15 : 0) +
        (smoke === "full" ? 0.05 : 0),
    ),
  };

  const score = SCORE_WEIGHTS.distance * breakdown.distance +
    SCORE_WEIGHTS.genre * breakdown.genre +
    SCORE_WEIGHTS.popularity * breakdown.popularity +
    SCORE_WEIGHTS.budget * breakdown.budget +
    SCORE_WEIGHTS.scene * breakdown.scene;

  const result: ShopResult = {
    id: shop.id,
    name: shop.name,
    genre: { code: shop.genre?.code ?? "", name: shop.genre?.name ?? "" },
    station: cleanStation(shop),
    access: shop.access ?? "",
    lat: shop.lat,
    lng: shop.lng,
    distanceM,
    etaMinutes: Math.round(eta),
    budget: {
      code: shop.budget?.code ?? "",
      name: shop.budget?.name ?? "",
      average: shop.budget?.average ?? "",
      mid: bud?.mid ?? 0,
    },
    photo: shop.photo?.pc?.l
      ? {
        s: shop.photo.pc.s ?? "",
        m: shop.photo.pc.m ?? "",
        l: shop.photo.pc.l ?? "",
      }
      : null,
    url: shop.urls?.pc ?? "",
    card: shop.card === "利用可",
    nonSmoking: smoke,
    partyCapacity: cap,
    seats: parseCapacity(shop.capacity),
    privateRoom: room,
    coupon: (shop.coupon_urls?.pc ?? "").length > 0,
    catch: shop.catch ?? "",
    rating: null,
    userRatingCount: null,
    ratingSource: null,
    googleMapsUri: null,
    hours: {
      status: parsedOpen.status,
      todayLabel: oh.todayLabel,
      lastOrderMin: oh.lastOrderMin,
      lastOrderLabel: oh.lastOrderMin != null ? minLabel(oh.lastOrderMin) : null,
      openAtTarget: oh.openAtTarget,
      disclaimer: hoursDisclaimer,
    },
    popularity,
    score: Number(score.toFixed(4)),
    scoreBreakdown: {
      distance: Number(breakdown.distance.toFixed(3)),
      genre: Number(breakdown.genre.toFixed(3)),
      popularity: Number(breakdown.popularity.toFixed(3)),
      budget: Number(breakdown.budget.toFixed(3)),
      scene: Number(breakdown.scene.toFixed(3)),
    },
    why: buildWhy({
      transport: ctx.transport,
      eta,
      bud,
      reqMid,
      budgetBreakdown: breakdown.budget,
      room,
      party: ctx.party,
      cap,
      oh,
    }),
  };

  return { scored: { result, score } };
}

function minLabel(min: number): string {
  const w = min % 1440;
  const h = Math.floor(w / 60);
  const mm = String(w % 60).padStart(2, "0");
  return `${min >= 1440 ? "翌" : ""}${String(h).padStart(2, "0")}:${mm}`;
}

const TRANSPORT_LABEL: Record<Transport, string> = {
  walk: "步行",
  bike: "自行车",
  train: "电车",
  car: "驾车",
};

function buildWhy(a: {
  transport: Transport;
  eta: number;
  bud: ReturnType<typeof parseBudgetName>;
  reqMid: number;
  budgetBreakdown: number;
  room: { available: boolean; detail: string } | null;
  party: number;
  cap: number;
  oh: ReturnType<typeof evaluateOpen>;
}): string[] {
  const bits: string[] = [];
  const eta = Math.round(a.eta);
  bits.push(
    eta < 1
      ? `${TRANSPORT_LABEL[a.transport]}就到，几乎在门口`
      : `${TRANSPORT_LABEL[a.transport]} 约 ${eta} 分钟`,
  );
  if (a.bud) {
    if (a.budgetBreakdown > 0.75) bits.push(`人均 ¥${a.bud.mid} 正好在预算内`);
    else if (a.bud.mid < a.reqMid) bits.push(`人均 ¥${a.bud.mid}，比预算省`);
  }
  if (a.room?.available && a.party >= 4) {
    bits.push("有包间");
  } else if (a.cap >= a.party + 4) {
    bits.push("位子宽松");
  }
  if (a.oh.todayLabel && a.oh.lastOrderMin != null) {
    bits.push(`营业到 ${a.oh.todayLabel.split("–")[1]}，L.O. ${minLabel(a.oh.lastOrderMin)}`);
  }
  return bits;
}
