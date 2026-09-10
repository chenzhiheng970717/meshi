// 合成「人气」分 —— 只在 Google 没返回 rating 时兜底（很少见）。
// 有 rating 时用 score.ts 的 ratingToPopularity。

import type { Candidate } from "./places.ts";

export function synthPopularity(c: Candidate): number {
  let s = 0.4;
  if ((c.userRatingCount ?? 0) > 0) s += 0.1;
  if ((c.userRatingCount ?? 0) >= 50) s += 0.1;
  if (c.reservable) s += 0.05;
  if (c.priceLevel) s += 0.05;
  if (c.photoName) s += 0.05;
  return Math.max(0, Math.min(1, s));
}
