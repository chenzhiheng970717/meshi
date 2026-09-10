// 去重：同一家店的重复条目（坐标几乎重合 + 名字主干相同）。
// Google 一般不会返一家店两次，但连锁「◯◯ 東口店 / ◯◯ 西口店」若挨得很近、
// 或 DISTANCE + POPULARITY 两次调用有重叠，还是会撞。按 id 去重不够。

import type { Candidate } from "./places.ts";

/** 名字主干：去空白、去分店后缀、去车站方位、去拉丁转写 */
export function nameCore(name: string): string {
  return (name || "")
    .replace(/[\s　]+/g, "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[A-Za-z].*$/, "")
    .replace(/(本店|支店|新館|別館|[0-9０-９]+号店|[0-9０-９]+号館|駅前店?|店)$/, "")
    .replace(
      /(新宿三丁目|新宿御苑前|新宿|歌舞伎町|東口|西口|南口|北口|中央口|甲州街道口)/g,
      "",
    )
    .trim();
}

function sameShop(a: Candidate, b: Candidate): boolean {
  const d = Math.hypot(
    (a.lat - b.lat) * 111000,
    (a.lng - b.lng) * 91000,
  );
  if (d > 15) return false;
  const ca = nameCore(a.name);
  const cb = nameCore(b.name);
  if (!ca || !cb) return false;
  return ca === cb || ca.includes(cb) || cb.includes(ca);
}

function richer(a: Candidate, b: Candidate): Candidate {
  const s = (c: Candidate) =>
    (c.rating != null ? 2 : 0) +
    (c.userRatingCount ?? 0) * 0.001 +
    (c.priceRange ? 1 : 0) +
    (c.photoName ? 1 : 0);
  return s(b) > s(a) ? b : a;
}

export function dedupeShops(list: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  for (const c of list) {
    const i = out.findIndex((k) => sameShop(k, c));
    if (i < 0) out.push(c);
    else out[i] = richer(out[i], c);
  }
  return out;
}
