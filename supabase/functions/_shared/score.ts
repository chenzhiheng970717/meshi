// 硬过滤 + 加权打分。权重在 SCORE_WEIGHTS，改逻辑不用发版。见 CLAUDE.md「推荐算法」。

import type { ShopResult, Transport } from "./contract.ts";
import type { Candidate } from "./places.ts";
import { GENRE_TYPES } from "./places.ts";
import { budgetCoverage, budgetOverlaps } from "./budget.ts";
import { etaMinutes, haversineM } from "./reach.ts";
import { evaluateGoogleHours } from "./googleHours.ts";
import { synthPopularity } from "./popularity.ts";

// 预算权重压低：区间覆盖率只当小加分项，"完全超出预算"靠硬过滤挡。
export const SCORE_WEIGHTS = {
  distance: 0.35,
  genre: 0.25,
  popularity: 0.25,
  budget: 0.05,
  scene: 0.10,
};

/** 打烊前留的余量（分钟）。Google 没有单独的 L.O.，按打烊前 45 分钟估。 */
export const CLOSE_MARGIN_MIN = 45;

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

export type RejectReason = "distance" | "hours" | "budget" | "genre";

export interface ScoredShop {
  result: ShopResult;
  score: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Google 评分 → 人气分 0..1。3.0 星→0，4.5 星→满；评论数取对数拉平。 */
export function ratingToPopularity(rating: number, count: number): number {
  const quality = (rating - 3.0) / 1.5;
  const volume = Math.min(1, Math.log10((count ?? 0) + 1) / 3.5);
  return clamp01(0.6 * quality + 0.4 * volume);
}

/** 该候选的 primaryType / types 与用户选的 genre 的匹配程度 */
function genreHit(c: Candidate, genres: string[]): "none" | "primary" | "loose" {
  if (!genres.length) return "none";
  const want = new Set(genres.flatMap((g) => GENRE_TYPES[g] ?? []));
  if (want.has(c.primaryType)) return "primary";
  if (c.types.some((t) => want.has(t))) return "loose";
  return "none"; // 关联不上（Google 的宽匹配带出来的杂项）
}

function shortAddress(a: string): string {
  let s = (a || "")
    .replace(/^日本[、,\s]*/, "")
    .replace(/〒?\s*[\d０-９]{3}-?[\d０-９]{4}\s*/, "")
    .replace(/^(東京都|東京)\s*/, "")
    .trim();
  // 到「番地」为止，去掉建物名 / 楼层
  const m = s.match(/^(.+?[\d０-９]+(?:[−-][\d０-９]+)*)\s+\S/);
  if (m) s = m[1];
  return s.replace(/\s+.*(ビル|館|BLDG|B\d|\dF).*$/i, "").trim().slice(0, 20);
}

function label(min: number): string {
  const w = ((min % 1440) + 1440) % 1440;
  return `${min >= 1440 ? "翌" : ""}${String(Math.floor(w / 60)).padStart(2, "0")}:${
    String(w % 60).padStart(2, "0")
  }`;
}

export function scoreShop(
  c: Candidate,
  ctx: ScoreContext,
): { scored: ScoredShop } | { reject: RejectReason } {
  const distanceM = haversineM(ctx.originLat, ctx.originLng, c.lat, c.lng);
  const eta = etaMinutes(ctx.transport, distanceM);
  if (eta > ctx.maxMinutes) return { reject: "distance" };

  // 预算：有 priceRange 才过滤；完全不重叠（含 10% 容差）挡掉
  if (c.priceRange && !budgetOverlaps(c.priceRange, ctx.budgetMin, ctx.budgetMax)) {
    return { reject: "budget" };
  }

  // 口味：用户选了类别、这家一点都不沾（连 types 里都没有）→ 挡掉
  const hit = genreHit(c, ctx.genres);
  if (ctx.genres.length && hit === "none") return { reject: "genre" };

  // 营业时间：优先 currentOpeningHours（含节假日），false 才挡，unknown 放行标注
  const oh = evaluateGoogleHours(
    c.currentHours ?? c.hours,
    ctx.when,
    ctx.timeMin,
    CLOSE_MARGIN_MIN,
  );
  if (oh.openAtTarget === false) return { reject: "hours" };
  const disclaimer = oh.openAtTarget === "unknown";

  // --- 打分 ---
  const popularity = c.rating != null
    ? ratingToPopularity(c.rating, c.userRatingCount ?? 0)
    : synthPopularity(c);

  const genreScore = { none: 0.6, primary: 1, loose: 0.85 }[hit];
  const budgetScore = c.priceRange
    ? budgetCoverage(c.priceRange, ctx.budgetMin, ctx.budgetMax)
    : 0.5;
  const scene = clamp01(
    0.55 +
      (c.reservable && ctx.party >= 4 ? 0.25 : 0) +
      (c.rating != null && c.rating >= 4.3 ? 0.1 : 0) +
      ((c.userRatingCount ?? 0) >= 300 ? 0.1 : 0),
  );

  const breakdown = {
    distance: clamp01(1 - eta / Math.max(1, ctx.maxMinutes)),
    genre: genreScore,
    popularity,
    budget: budgetScore,
    scene,
  };
  const score = SCORE_WEIGHTS.distance * breakdown.distance +
    SCORE_WEIGHTS.genre * breakdown.genre +
    SCORE_WEIGHTS.popularity * breakdown.popularity +
    SCORE_WEIGHTS.budget * breakdown.budget +
    SCORE_WEIGHTS.scene * breakdown.scene;

  const smallPlace = (c.userRatingCount ?? 999) < 60 ||
    /counter|stand|bar$|coffee|cafe/i.test(c.primaryType);

  const result: ShopResult = {
    id: c.id,
    name: c.name,
    genre: { type: c.primaryType, label: c.primaryTypeLabel },
    address: shortAddress(c.address),
    lat: c.lat,
    lng: c.lng,
    distanceM,
    etaMinutes: Math.round(eta),
    budget: c.priceRange
      ? { lo: c.priceRange.lo, hi: c.priceRange.hi, level: c.priceLevel }
      : null,
    photo: null,
    photoName: c.photoName,
    url: c.mapsUri,
    rating: c.rating,
    userRatingCount: c.userRatingCount,
    reservable: c.reservable,
    hours: {
      todayLabel: oh.todayLabel,
      closeMin: oh.closeMin,
      closeLabel: oh.closeMin != null ? label(oh.closeMin) : null,
      lastArrivalLabel: oh.lastArrivalMin != null ? label(oh.lastArrivalMin) : null,
      openAtTarget: oh.openAtTarget,
      disclaimer,
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
    why: buildWhy({ transport: ctx.transport, eta, c, ctx, oh, smallPlace }),
  };
  return { scored: { result, score } };
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
  c: Candidate;
  ctx: ScoreContext;
  oh: ReturnType<typeof evaluateGoogleHours>;
  smallPlace: boolean;
}): string[] {
  const bits: string[] = [];
  const eta = Math.round(a.eta);
  bits.push(
    eta < 1
      ? `${TRANSPORT_LABEL[a.transport]}就到，几乎在门口`
      : `${TRANSPORT_LABEL[a.transport]} 约 ${eta} 分钟`,
  );
  if (a.c.priceRange) {
    const { lo, hi } = a.c.priceRange;
    const r = lo === hi ? `¥${lo}` : `¥${lo}–${hi}`;
    if (lo >= a.ctx.budgetMin && hi <= a.ctx.budgetMax) bits.push(`人均 ${r}，在预算内`);
    else if (hi <= (a.ctx.budgetMin + a.ctx.budgetMax) / 2) bits.push(`人均 ${r}，偏预算下段`);
  }
  if (a.c.rating != null && a.c.rating >= 4.3) {
    bits.push(`Google ${a.c.rating.toFixed(1)}（${a.c.userRatingCount ?? 0} 评价）`);
  }
  if (a.oh.todayLabel && a.oh.closeMin != null) {
    bits.push(`营业到 ${a.oh.todayLabel.split("–")[1]}`);
  }
  if (a.ctx.party >= 8 && a.smallPlace) {
    bits.push("大团请先电话确认能否坐下");
  } else if (a.c.reservable && a.ctx.party >= 4) {
    bits.push("可预约");
  }
  return bits;
}
