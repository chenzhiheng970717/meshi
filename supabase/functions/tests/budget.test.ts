import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budgetCoverage,
  budgetOverlaps,
  parseBudgetName,
} from "../_shared/budget.ts";

test("parseBudgetName: 常见格式", () => {
  assert.deepEqual(parseBudgetName("2001～3000円"), { lo: 2001, hi: 3000, mid: 2501 });
  assert.deepEqual(parseBudgetName("～1500円"), { lo: 0, hi: 1500, mid: 750 });
  assert.deepEqual(parseBudgetName("1500円以下"), { lo: 0, hi: 1500, mid: 750 });
  assert.deepEqual(parseBudgetName("30001円～"), { lo: 30001, hi: 45002, mid: 37502 });
  assert.equal(parseBudgetName(""), null);
  assert.equal(parseBudgetName(null), null);
});

test("parseBudgetName: 全角数字 + 逗号", () => {
  assert.deepEqual(parseBudgetName("４，０００～５，０００円"), {
    lo: 4000,
    hi: 5000,
    mid: 4500,
  });
});

test("budgetOverlaps: 完全超出 → false，边缘容差内 → true", () => {
  // 用户 2000–5000
  assert.equal(budgetOverlaps({ lo: 3001, hi: 4000, mid: 3500 }, 2000, 5000), true);
  assert.equal(budgetOverlaps({ lo: 8000, hi: 10000, mid: 9000 }, 2000, 5000), false);
  // ¥5,300 的店，10% 容差内还算数
  assert.equal(budgetOverlaps({ lo: 5001, hi: 5300, mid: 5150 }, 2000, 5000), true);
  assert.equal(budgetOverlaps({ lo: 6000, hi: 7000, mid: 6500 }, 2000, 5000), false);
});

test("budgetCoverage: 区间覆盖率", () => {
  // 用户 2000–5000（宽 3000），店铺 4000–6000 → 重叠 4000–5000 = 1000 → 0.33
  assert.equal(
    Number(budgetCoverage({ lo: 4000, hi: 6000, mid: 5000 }, 2000, 5000).toFixed(2)),
    0.33,
  );
  // 店铺完全在预算内且窄 → 覆盖率不高，但打分权重低所以无所谓
  assert.equal(
    Number(budgetCoverage({ lo: 3000, hi: 4000, mid: 3500 }, 2000, 5000).toFixed(2)),
    0.33,
  );
  // 店铺区间跨满用户区间 → 1.0
  assert.equal(budgetCoverage({ lo: 1000, hi: 9000, mid: 5000 }, 2000, 5000), 1);
  // 完全不重叠 → 0
  assert.equal(budgetCoverage({ lo: 8000, hi: 9000, mid: 8500 }, 2000, 5000), 0);
});
