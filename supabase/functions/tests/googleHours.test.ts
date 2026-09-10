import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGoogleHours } from "../_shared/googleHours.ts";

// 2026-09-11 是周五（getDay()=5）；周一 = 09-14
const FRI = new Date("2026-09-11T00:00:00");
const MON = new Date("2026-09-14T00:00:00");
const at = (h: number, m = 0) => h * 60 + m;

const daily = (oh: number, ch: number, cd = (d: number) => d) =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    open: { day: d, hour: oh, minute: 0 },
    close: { day: cd(d), hour: ch, minute: 0 },
  }));

test("常规晚市：19:00 在营业中", () => {
  const e = evaluateGoogleHours({ periods: daily(17, 23) }, FRI, at(19), 45);
  assert.equal(e.openAtTarget, true);
  assert.equal(e.closeMin, at(23));
  assert.equal(e.lastArrivalMin, at(23) - 45);
});

test("跨夜：close.day 是次日，凌晨 1:00 仍算营业", () => {
  const periods = daily(17, 3, (d) => (d + 1) % 7); // 每天 17:00 到次日 3:00
  const e = evaluateGoogleHours({ periods }, MON, at(1), 45);
  assert.equal(e.openAtTarget, true);
  assert.equal(e.closeMin, 1440 + at(3));
});

test("17:00 才开，15:00 → 未营业", () => {
  const e = evaluateGoogleHours({ periods: daily(17, 23) }, FRI, at(15), 45);
  assert.equal(e.openAtTarget, false);
});

test("没有 periods → unknown", () => {
  const e = evaluateGoogleHours({}, FRI, at(19), 45);
  assert.equal(e.openAtTarget, "unknown");
  assert.equal(e.lastArrivalMin, null);
});

test("目标那天没有 period → 当天休息", () => {
  const periods = [1, 2, 3, 4, 5].map((d) => ({
    open: { day: d, hour: 11, minute: 0 },
    close: { day: d, hour: 20, minute: 0 },
  })); // 只有周一到周五
  const SUN = new Date("2026-09-13T00:00:00");
  const e = evaluateGoogleHours({ periods }, SUN, at(15), 45);
  assert.equal(e.openAtTarget, false);
  assert.equal(e.todayLabel, "当天休息");
});

test("24 小时营业（period 无 close）", () => {
  const e = evaluateGoogleHours(
    { periods: [{ open: { day: 5, hour: 0, minute: 0 } }] },
    FRI,
    at(3),
    45,
  );
  assert.equal(e.openAtTarget, true);
});
