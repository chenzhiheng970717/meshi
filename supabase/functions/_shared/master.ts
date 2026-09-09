// ジャンルマスタAPI / 検索用予算マスタAPI 的客户端。
//
// genre / budget 参数要传码不传文字，且码表会变 —— 不硬编码（CLAUDE.md）。
// 启动时拉一次，进程内缓存 24h；拉失败回落到 ./mock/*-master.json 的快照。

import genreSnapshot from "./mock/genre-master.json" with { type: "json" };
import budgetSnapshot from "./mock/budget-master.json" with { type: "json" };
import { parseBudgetName } from "./budget.ts";

export interface MasterEntry {
  code: string;
  name: string;
}

const GENRE_ENDPOINT = "https://webservice.recruit.co.jp/hotpepper/genre/v1/";
const BUDGET_ENDPOINT = "https://webservice.recruit.co.jp/hotpepper/budget/v1/";
const TTL_MS = 24 * 60 * 60 * 1000;

export interface Masters {
  at: number;
  genres: MasterEntry[];
  budgets: MasterEntry[];
  source: "hotpepper" | "snapshot";
}
let cache: Masters | null = null;

async function fetchMaster(url: string, key: string, field: string): Promise<MasterEntry[]> {
  const u = new URL(url);
  u.searchParams.set("key", key);
  u.searchParams.set("format", "json");
  const res = await fetch(u);
  if (!res.ok) throw new Error(`master ${field} ${res.status}`);
  const json = await res.json();
  const rows = json?.results?.[field];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`master ${field} 返回为空`);
  }
  return rows.map((r: { code: string; name: string }) => ({
    code: String(r.code),
    name: String(r.name),
  }));
}

function snapshot(): Masters {
  return {
    at: Date.now(),
    genres: (genreSnapshot as { genre: MasterEntry[] }).genre,
    budgets: (budgetSnapshot as { budget: MasterEntry[] }).budget,
    source: "snapshot",
  };
}

/**
 * 拿到 genre / budget 码表。无 key 直接用快照；有 key 且缓存过期则拉一次，
 * 拉失败也回落快照（不让码表问题挡住搜索）。
 */
export async function getMasters(key?: string): Promise<Masters> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  if (!key) {
    cache = snapshot();
    return cache;
  }
  try {
    const [genres, budgets] = await Promise.all([
      fetchMaster(GENRE_ENDPOINT, key, "genre"),
      fetchMaster(BUDGET_ENDPOINT, key, "budget"),
    ]);
    cache = { at: Date.now(), genres, budgets, source: "hotpepper" };
  } catch (err) {
    console.error("master 拉取失败，回落快照:", (err as Error).message);
    cache = snapshot();
  }
  return cache;
}

/** 把用户的人均预算区间映射成 budget 码（一次最多 2 个）。 */
export function budgetCodesFor(
  budgets: MasterEntry[],
  min: number,
  max: number,
): string[] {
  const scored = budgets
    .map((b) => ({ b, r: parseBudgetName(b.name) }))
    .filter((x) => x.r && x.r.lo <= max && x.r.hi >= min)
    .sort((a, b) => {
      // 与请求区间中点最近的优先
      const mid = (min + max) / 2;
      return Math.abs((a.r!.mid) - mid) - Math.abs((b.r!.mid) - mid);
    });
  return scored.slice(0, 2).map((x) => x.b.code);
}

/** 测试用：清掉进程内缓存 */
export function _resetMasterCache(): void {
  cache = null;
}
