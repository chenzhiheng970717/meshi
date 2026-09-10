import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetCoverage, budgetOverlaps } from "../_shared/budget.ts";

test("budgetOverlaps: 完全超出 → false，边缘容差内 → true", () => {
  assert.equal(budgetOverlaps({ lo: 3000, hi: 4000 }, 2000, 5000), true);
  assert.equal(budgetOverlaps({ lo: 8000, hi: 10000 }, 2000, 5000), false);
  assert.equal(budgetOverlaps({ lo: 5100, hi: 5300 }, 2000, 5000), true); // 10% 容差内
  assert.equal(budgetOverlaps({ lo: 6000, hi: 7000 }, 2000, 5000), false);
});

test("budgetCoverage: 区间覆盖率", () => {
  // 用户 2000–5000（宽 3000），店铺 4000–6000 → 重叠 4000–5000 = 1000 → 0.33
  assert.equal(
    Number(budgetCoverage({ lo: 4000, hi: 6000 }, 2000, 5000).toFixed(2)),
    0.33,
  );
  assert.equal(budgetCoverage({ lo: 1000, hi: 9000 }, 2000, 5000), 1);
  assert.equal(budgetCoverage({ lo: 8000, hi: 9000 }, 2000, 5000), 0);
});
