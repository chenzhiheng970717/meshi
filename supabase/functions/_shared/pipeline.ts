// /search 主管道：Google Places 拉候选 → 去重 → 硬过滤 + 打分 → 排序 → 分页 →
// 补照片 → 组装响应。前端 / dev-server / Edge Function 都调 runSearch。

import {
  ATTRIBUTION,
  type SearchRequest,
  type SearchResponse,
} from "./contract.ts";
import { type Candidate, createPlaces } from "./places.ts";
import { haversineM, reachRadiusM } from "./reach.ts";
import { dedupeShops } from "./dedupe.ts";
import { createGoogle } from "./google.ts";
import { type RejectReason, scoreShop, type ScoreContext } from "./score.ts";

const PAGE_SIZE = 5;

export interface RunOptions {
  env?: { GOOGLE_PLACES_API_KEY?: string };
  mockCandidates?: Candidate[];
  /** 注入 fetch（测试用） */
  fetchImpl?: typeof fetch;
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
    transport: ["walk", "bike", "train", "car"].includes(b.transport)
      ? b.transport
      : "walk",
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
  if (Number.isNaN(new Date(req.datetime).getTime())) {
    throw new HttpError(400, "datetime 无法解析，需 ISO 本地时间如 2026-09-10T19:00");
  }
  return req;
}

export async function runSearch(
  req: SearchRequest,
  opts: RunOptions = {},
): Promise<SearchResponse> {
  const when = new Date(req.datetime);
  const timeMin = when.getHours() * 60 + when.getMinutes();
  const radiusM = reachRadiusM(req.transport, req.maxMinutes);

  const places = createPlaces({
    GOOGLE_PLACES_API_KEY: opts.env?.GOOGLE_PLACES_API_KEY,
    mockCandidates: opts.mockCandidates,
    fetchImpl: opts.fetchImpl,
  });

  const notes: string[] = [];
  const rejected = {
    distance: 0,
    hours: 0,
    budget: 0,
    genre: 0,
    excluded: 0,
    disliked: 0,
    notFood: 0,
  };

  let candidates: Candidate[] = [];
  if (radiusM <= 0) {
    notes.push("可达半径为 0：路程时长不足以覆盖交通固定开销");
  } else {
    const raw = await places.search({
      lat: req.origin.lat,
      lng: req.origin.lng,
      radiusM,
      genres: req.genres,
    });
    candidates = dedupeShops(raw);
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
  for (const c of candidates) {
    if (dislikeSet.has(c.id)) {
      rejected.disliked++;
      continue;
    }
    if (excludeSet.has(c.id)) {
      rejected.excluded++;
      continue;
    }
    if (haversineM(req.origin.lat, req.origin.lng, c.lat, c.lng) > radiusM) {
      rejected.distance++;
      continue;
    }
    const r = scoreShop(c, ctx);
    if ("reject" in r) {
      rejected[r.reject as RejectReason]++;
      continue;
    }
    if (r.scored.result.hours.disclaimer) degradedHours++;
    scored.push(r.scored);
  }
  scored.sort((a, b) => b.score - a.score);

  if (degradedHours > 0) {
    notes.push(`${degradedHours} 家没有营业时间数据，已按不过滤处理并在卡片标注`);
  }
  if (places.source === "mock") {
    notes.push("数据来源：演示数据（未接入 Google）。店铺信息均为示例");
  }

  const total = scored.length;
  const batches = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const batch = Math.min(Math.max(0, req.batch ?? 0), batches - 1);
  const page = scored.slice(batch * PAGE_SIZE, batch * PAGE_SIZE + PAGE_SIZE);
  const results = page.map((s) => s.result);

  // 只给返回的这批解析照片（控制 Photo Media 调用量）
  if (places.source === "google") {
    const g = createGoogle({ key: opts.env?.GOOGLE_PLACES_API_KEY });
    await Promise.all(
      results.map(async (r) => {
        if (r.photoName) {
          const url = await g.resolvePhoto(r.photoName, 800);
          if (url) r.photo = { url };
        }
      }),
    );
  }

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
    source: places.source,
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
