import { test } from "node:test";
import assert from "node:assert/strict";
import { etaMinutes, haversineM, reachRadiusM } from "../_shared/reach.ts";

test("可达半径公式", () => {
  assert.equal(reachRadiusM("walk", 20), 1600);
  assert.equal(reachRadiusM("bike", 20), 5000);
  assert.equal(reachRadiusM("train", 20), (20 - 12) * 400);
  assert.equal(reachRadiusM("car", 20), (20 - 10) * 300);
});

test("时长不足以覆盖固定开销 → 半径 0", () => {
  assert.equal(reachRadiusM("train", 10), 0);
  assert.equal(reachRadiusM("car", 8), 0);
});

test("etaMinutes 是 reachRadius 的逆", () => {
  assert.equal(Math.round(etaMinutes("walk", reachRadiusM("walk", 20))), 20);
});

test("haversine: 新宿駅 ↔ 徒歩圏", () => {
  const d = haversineM(35.6912, 139.702, 35.6919, 139.7031);
  assert.ok(d > 100 && d < 200, `期望 100–200m，实际 ${d}`);
});
