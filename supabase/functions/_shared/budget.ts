// budget.name 解析。
// average 是自由文本（"4000円(通常平均)/4300円(宴会平均)"），不能当数字用；
// 打分从 budget.name 的区间取中位数。见 docs/api-response.md「预算」。

export interface BudgetRange {
  lo: number;
  hi: number;
  mid: number;
}

/**
 * "2001～3000円"       → { lo:2001, hi:3000, mid:2500 }
 * "~1500円" / "1500円以下" → { lo:0,   hi:1500 }
 * "10001円～"          → { lo:10001, hi:15000 }（无上界按 +50% 估）
 */
export function parseBudgetName(name: string | null | undefined): BudgetRange | null {
  if (!name) return null;
  const s = name
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[〜~]/g, "～")
    .replace(/[,，]/g, ""); // 去掉千分位（含全角逗号）
  const nums = [...s.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
  if (nums.length === 0) return null;

  let lo: number;
  let hi: number;
  const firstDigit = s.search(/\d/);
  const tildeBeforeDigit = s.includes("～") && s.indexOf("～") < firstDigit;
  if (nums.length >= 2) {
    lo = Math.min(nums[0], nums[1]);
    hi = Math.max(nums[0], nums[1]);
  } else if (tildeBeforeDigit || /以下|まで/.test(s)) {
    lo = 0;
    hi = nums[0];
  } else if (/以上/.test(s) || /\d[\d,]*円?\s*～\s*$/.test(s)) {
    lo = nums[0];
    hi = Math.round(nums[0] * 1.5);
  } else {
    lo = nums[0];
    hi = nums[0];
  }
  return { lo, hi, mid: Math.round((lo + hi) / 2) };
}

/** 两个区间是否重叠（含容差）。tol 为端点各放宽的比例。 */
export function budgetOverlaps(
  shop: BudgetRange,
  reqMin: number,
  reqMax: number,
  tol = 0.1,
): boolean {
  const lo = reqMin * (1 - tol);
  const hi = reqMax * (1 + tol);
  return shop.lo <= hi && shop.hi >= lo;
}

/**
 * 区间覆盖率：店铺人均区间与用户预算区间的重叠宽度，占用户区间宽度的比例。
 * 用户 2000–5000、店铺 4000–6000 → 重叠 4000–5000 = 1000，占 3000 → 0.33。
 * 打分只当小权重的加分项，真正的过滤靠 budgetOverlaps。
 */
export function budgetCoverage(
  shop: BudgetRange,
  reqMin: number,
  reqMax: number,
): number {
  const reqWidth = Math.max(1, reqMax - reqMin);
  const overlap = Math.max(0, Math.min(shop.hi, reqMax) - Math.max(shop.lo, reqMin));
  return Math.max(0, Math.min(1, overlap / reqWidth));
}
