// 预算区间的过滤 / 打分。数据来自 Google priceRange（{lo, hi} 円）。

export interface Range {
  lo: number;
  hi: number;
}

/** 店铺人均区间与用户预算区间是否重叠（含容差）。tol 为端点各放宽的比例。 */
export function budgetOverlaps(
  shop: Range,
  reqMin: number,
  reqMax: number,
  tol = 0.1,
): boolean {
  return shop.lo <= reqMax * (1 + tol) && shop.hi >= reqMin * (1 - tol);
}

/**
 * 区间覆盖率：店铺人均区间与用户预算区间的重叠宽度，占用户区间宽度的比例。
 * 用户 2000–5000、店铺 4000–6000 → 重叠 4000–5000 = 1000，占 3000 → 0.33。
 * 只当小权重的加分项，真正的过滤靠 budgetOverlaps。
 */
export function budgetCoverage(
  shop: Range,
  reqMin: number,
  reqMax: number,
): number {
  const reqWidth = Math.max(1, reqMax - reqMin);
  const overlap = Math.max(
    0,
    Math.min(shop.hi, reqMax) - Math.max(shop.lo, reqMin),
  );
  return Math.max(0, Math.min(1, overlap / reqWidth));
}
