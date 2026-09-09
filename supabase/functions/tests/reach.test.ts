import { test } from "node:test";
import assert from "node:assert/strict";
import {
  etaMinutes,
  haversineM,
  rangeCode,
  reachRadiusM,
  samplingCenters,
} from "../_shared/reach.ts";

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
  const r = reachRadiusM("walk", 20);
  assert.equal(Math.round(etaMinutes("walk", r)), 20);
});

test("haversine: 新宿駅 ↔ 徒歩圏", () => {
  const d = haversineM(35.6912, 139.702, 35.6919, 139.7031);
  assert.ok(d > 100 && d < 200, `期望 100–200m，实际 ${d}`);
});

test("rangeCode 取覆盖目标的最小档", () => {
  assert.equal(rangeCode(280), 1);
  assert.equal(rangeCode(500), 2);
  assert.equal(rangeCode(1000), 3);
  assert.equal(rangeCode(1800), 4);
  assert.equal(rangeCode(6000), 5);
});

test("samplingCenters: ≤3km 单点，>3km 九点", () => {
  assert.equal(samplingCenters(35.68, 139.76, 2500).length, 1);
  const c = samplingCenters(35.68, 139.76, 6000);
  assert.equal(c.length, 9);
  // 采样点应落在目标半径附近
  for (const p of c.slice(1)) {
    const d = haversineM(35.68, 139.76, p.lat, p.lng);
    assert.ok(Math.abs(d - 6000) < 50, `采样点距圆心 ${d}m`);
  }
});
