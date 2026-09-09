// /search 主管道：拉候选 → 硬过滤 + 打分 → 排序 → 分页 → 组装响应。
// 前端和 dev-server / Edge Function 都调 runSearch，保证行为一致。

import {
  ATTRIBUTION,
  type SearchRequest,
  type SearchResponse,
} from "./contract.ts";
import { createClient, type RawShop } from "./hotpepper.ts";
import { haversineM, reachRadiusM } from "./reach.ts";
import {
  type RejectReason,
  scoreShop,
  type ScoreContext,
} from "./score.ts";

const PAGE_SIZE = 5;

export interface RunOptions {
  env?: { HOTPEPPER_API_KEY?: string };
  mockShops?: RawShop[];
  /** genre 名→码，budget 请求区间→码。缺省用简单映射。 */
  budgetCodesFor?: (min: number, max: number) => string[];
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

function defaultBudgetCodes(min: number, max: number): string[] {
  // 检索用予算マスタ 的近似区间。正式版从 master API 动态拉取后替换。
  const table: Array<[string, number, number]> = [
    ["B009", 0, 500],
    ["B010", 501, 1000],
    ["B011", 1001, 1500],
    ["B001", 1501, 2000],
    ["B002", 2001, 3000],
    ["B003", 3001, 4000],
    ["B008", 4001, 5000],
    ["B004", 5001, 7000],
    ["B005", 7001, 10000],
    ["B006", 10001, 15000],
    ["B012", 15001, 20000],
    ["B007", 20001, 30000],
    ["B013", 30001, 999999],
  ];
  return table
    .filter(([, lo, hi]) => lo <= max && hi >= min)
    .map(([code]) => code)
    .slice(0, 2);
}

export async function runSearch(
  req: SearchRequest,
  opts: RunOptions = {},
): Promise<SearchResponse> {
  const when = new Date(req.datetime);
  const timeMin = when.getHours() * 60 + when.getMinutes();
  const radiusM = reachRadiusM(req.transport, req.maxMinutes);

  const client = createClient({
    HOTPEPPER_API_KEY: opts.env?.HOTPEPPER_API_KEY,
    mockShops: opts.mockShops,
  });

  const budgetCodesFor = opts.budgetCodesFor ?? defaultBudgetCodes;

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
      budgetCodes: budgetCodesFor(req.budgetMin, req.budgetMax),
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
  }

  const total = scored.length;
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
