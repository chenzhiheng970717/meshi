// /search 主管道：拉候选 → 硬过滤 + 打分 → 排序 → 分页 → 组装响应。
// 前端和 dev-server / Edge Function 都调 runSearch，保证行为一致。

import {
  ATTRIBUTION,
  type SearchRequest,
  type SearchResponse,
} from "./contract.ts";
import { createClient, type RawShop } from "./hotpepper.ts";
import { haversineM, reachRadiusM } from "./reach.ts";
import { budgetCodesFor, getMasters } from "./master.ts";
import { createGoogle } from "./google.ts";
import {
  applyGoogleRating,
  type RejectReason,
  scoreShop,
  type ScoreContext,
} from "./score.ts";

const PAGE_SIZE = 5;
/** 补 Google 评分并重排的候选数（≈4 批）。评分进排序才公平，但更多＝更多配额。 */
const GOOGLE_ENRICH_N = 20;

export interface RunOptions {
  env?: { HOTPEPPER_API_KEY?: string; GOOGLE_PLACES_API_KEY?: string };
  mockShops?: RawShop[];
  /** 注入 fetch（测试用），传给 Google 客户端 */
  googleFetch?: typeof fetch;
}

export function normalizeRequest(body: unknown): SearchRequest {
  const b = (body ?? {}) as Record<string, any>;
  const origin = b.origin ?? {};
  const req: SearchRequest = {
    origin: {
      lat: Number(origin.lat),
      lng: Number(origin.lng),
      label: origin.label ? String(origin.label) : undefined,
    },
    datetime: String(b.datetime ?? ""),
    transport: (["walk", "bike", "train", "car"].includes(b.transport)
      ? b.transport
      : "walk"),
    maxMinutes: clampNum(b.maxMinutes, 5, 120, 20),
    party: clampNum(b.party, 1, 50, 2),
    genres: Array.isArray(b.genres) ? b.genres.map(String) : [],
    budgetMin: clampNum(b.budgetMin, 0, 100000, 2000),
    budgetMax: clampNum(b.budgetMax, 0, 100000, 5000),
    exclude: Array.isArray(b.exclude) ? b.exclude.map(String) : [],
    disliked: Array.isArray(b.disliked) ? b.disliked.map(String) : [],
    batch: clampNum(b.batch, 0, 999, 0),
  };
  if (req.budgetMax < req.budgetMin) req.budgetMax = req.budgetMin;
  if (!Number.isFinite(req.origin.lat) || !Number.isFinite(req.origin.lng)) {
    throw new HttpError(400, "origin.lat / origin.lng 必填且须为数字");
  }
  const t = new Date(req.datetime);
  if (Number.isNaN(t.getTime())) {
    throw new HttpError(400, "datetime 无法解析，需 ISO 本地时间如 2026-09-10T19:00");
  }
  return req;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}


export async function runSearch(
  req: SearchRequest,
  opts: RunOptions = {},
): Promise<SearchResponse> {
  const when = new Date(req.datetime);
  const timeMin = when.getHours() * 60 + when.getMinutes();
  const radiusM = reachRadiusM(req.transport, req.maxMinutes);

  const key = opts.env?.HOTPEPPER_API_KEY;
  const client = createClient({
    HOTPEPPER_API_KEY: key,
    mockShops: opts.mockShops,
  });

  const masters = await getMasters(key);

  const notes: string[] = [];
  const rejected = {
    distance: 0,
    hours: 0,
    capacity: 0,
    budget: 0,
    genre: 0,
    excluded: 0,
    disliked: 0,
  };

  let candidates: RawShop[] = [];
  if (radiusM <= 0) {
    notes.push("可达半径为 0：路程时长不足以覆盖交通固定开销");
  } else {
    candidates = await client.gather({
      lat: req.origin.lat,
      lng: req.origin.lng,
      radiusM,
      genres: req.genres,
      budgetCodes: budgetCodesFor(masters.budgets, req.budgetMin, req.budgetMax),
      party: req.party,
    });
  }

  const excludeSet = new Set(req.exclude ?? []);
  const dislikeSet = new Set(req.disliked ?? []);

  const ctx: ScoreContext = {
    originLat: req.origin.lat,
    originLng: req.origin.lng,
    transport: req.transport,
    maxMinutes: req.maxMinutes,
    party: req.party,
    genres: req.genres,
    budgetMin: req.budgetMin,
    budgetMax: req.budgetMax,
    when,
    timeMin,
  };

  const scored = [];
  let degradedHours = 0;
  for (const shop of candidates) {
    if (dislikeSet.has(shop.id)) {
      rejected.disliked++;
      continue;
    }
    if (excludeSet.has(shop.id)) {
      rejected.excluded++;
      continue;
    }
    // 半径预筛（gather 已粗筛，这里精筛）
    if (haversineM(req.origin.lat, req.origin.lng, shop.lat, shop.lng) > radiusM) {
      rejected.distance++;
      continue;
    }
    const r = scoreShop(shop, ctx);
    if ("reject" in r) {
      rejected[r.reject as RejectReason]++;
      continue;
    }
    if (r.scored.result.hours.disclaimer) degradedHours++;
    scored.push(r.scored);
  }

  scored.sort((a, b) => b.score - a.score);

  if (degradedHours > 0) {
    notes.push(`${degradedHours} 家营业时间无法确定，已按不过滤处理并在卡片标注`);
  }
  if (client.source === "mock") {
    notes.push("数据来源：演示数据（未接入 HotPepper）。店铺、营业信息均为示例");
  } else if (masters.source === "snapshot") {
    notes.push("genre / budget 码表拉取失败，暂用快照");
  }

  const total = scored.length;

  // Google Places 评分（ADR-004）：对初排前 GOOGLE_ENRICH_N 家补评分，
  // 用真实评分重算「人气」项后**重排**（进排序才公平，见 roadmap「打分调优」）。
  // 更靠后的候选不补，也进不了前几批。
  const google = createGoogle({
    key: opts.env?.GOOGLE_PLACES_API_KEY,
    fetchImpl: opts.googleFetch,
  });
  if (google.enabled && scored.length) {
    const head = scored.slice(0, GOOGLE_ENRICH_N);
    const ratings = await google.ratingsFor(
      head.map((s) => ({
        id: s.result.id,
        name: s.result.name,
        lat: s.result.lat,
        lng: s.result.lng,
      })),
    );
    let hit = 0;
    for (const s of head) {
      const g = ratings.get(s.result.id);
      if (g) {
        s.result.rating = g.rating;
        s.result.userRatingCount = g.userRatingCount;
        s.result.ratingSource = "google";
        s.result.googleMapsUri = g.mapsUri || null;
        applyGoogleRating(s, g);
        hit++;
      }
    }
    // 只在补过评分的这批内部重排，尾部保持原序 —— 不让没补评分的候选
    // （合成人气分偏高）借重排挤进前排。
    head.sort((a, b) => b.score - a.score);
    scored.splice(0, head.length, ...head);
    notes.push(
      `已用 Google 评分重排前 ${head.length} 家（${hit} 家匹配到），其余显示合成人气分`,
    );
  }

  const batches = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const batch = Math.min(Math.max(0, req.batch ?? 0), batches - 1);
  const results = scored
    .slice(batch * PAGE_SIZE, batch * PAGE_SIZE + PAGE_SIZE)
    .map((s) => s.result);

  return {
    request: { ...req, datetime: when.toISOString() },
    reach: { radiusM: Math.round(radiusM), formula: reachFormula(req) },
    total,
    batch,
    batches,
    results,
    rejected,
    attribution: { text: ATTRIBUTION.text, url: ATTRIBUTION.url },
    notes,
    source: client.source,
  };
}

function reachFormula(req: SearchRequest): string {
  const m: Record<string, string> = {
    walk: `${req.maxMinutes} × 80 m/min`,
    bike: `${req.maxMinutes} × 250 m/min`,
    train: `max(0, ${req.maxMinutes} − 12) × 400 m/min`,
    car: `max(0, ${req.maxMinutes} − 10) × 300 m/min`,
  };
  return m[req.transport];
}
