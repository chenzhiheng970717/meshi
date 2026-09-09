import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateOpen,
  normalize,
  parseClose,
  parseOpen,
} from "../_shared/openHours.ts";

// 0=月 … 6=日
const MON = new Date("2026-09-07T00:00:00"); // 月曜
const FRI = new Date("2026-09-11T00:00:00"); // 金曜
const SUN = new Date("2026-09-13T00:00:00"); // 日曜
const at = (h: number, m = 0) => h * 60 + m;

test("normalize: 全角数字 / 冒号 / 波浪号 / L.O. 写法", () => {
  assert.equal(
    normalize("月～金：１７:００〜２３:３０（ラストオーダー23:00）"),
    "月～金:17:00～23:30（L.O.23:00）",
  );
});

test("docs 样本 1: 月～木、日、祝日 + 金、土 跨夜", () => {
  const raw =
    "月～木、日、祝日: 11:30～翌0:00 （料理L.O. 23:30 ドリンクL.O. 23:30）金、土: 11:30～翌3:00 （料理L.O. 翌2:30 ドリンクL.O. 翌2:30）";
  const p = parseOpen(raw);
  assert.equal(p.status, "ok");
  assert.equal(p.segments.length, 2);

  const wk = p.segments[0];
  assert.deepEqual(wk.weekdays, [0, 1, 2, 3, 6]); // 月火水木 + 日（祝日忽略）
  assert.equal(wk.openMin, at(11, 30));
  assert.equal(wk.closeMin, 1440); // 翌0:00
  assert.equal(wk.loFoodMin, at(23, 30));

  const wknd = p.segments[1];
  assert.deepEqual(wknd.weekdays, [4, 5]); // 金土
  assert.equal(wknd.closeMin, 1440 + at(3, 0)); // 翌3:00 = 27:00
  assert.equal(wknd.loFoodMin, 1440 + at(2, 30));
});

test("docs 样本 2: 四段，含 祝前日", () => {
  const raw =
    "月～木: 17:00～23:00 （料理L.O. 22:00 ドリンクL.O. 22:00）金、祝前日: 17:00～翌2:00 （料理L.O. 翌1:00）土: 13:00～23:00 （料理L.O. 22:00）日、祝日: 13:00～22:00 （料理L.O. 21:00）";
  const p = parseOpen(raw);
  assert.equal(p.segments.length, 4);
  assert.deepEqual(p.segments[0].weekdays, [0, 1, 2, 3]);
  assert.deepEqual(p.segments[1].weekdays, [4]); // 金（祝前日 忽略）
  assert.deepEqual(p.segments[2].weekdays, [5]);
  assert.deepEqual(p.segments[3].weekdays, [6]);
  assert.equal(p.segments[1].closeMin, 1440 + at(2, 0));
});

test("docs 样本 3: 单段全周", () => {
  const raw =
    "月～日、祝日、祝前日: 17:00～23:30 （料理L.O. 22:30 ドリンクL.O. 23:00）";
  const p = parseOpen(raw);
  assert.equal(p.status, "ok");
  assert.equal(p.segments.length, 1);
  assert.deepEqual(p.segments[0].weekdays, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(p.segments[0].loFoodMin, at(22, 30));
  assert.equal(p.segments[0].loDrinkMin, at(23, 0));
});

test("裸 L.O.（无 料理/ドリンク 前缀）当作料理 L.O.", () => {
  const p = parseOpen("月～土: 15:00～23:30 （L.O. 23:00）");
  assert.equal(p.segments[0].loFoodMin, at(23, 0));
});

test("フードL.O. 规范成 料理L.O.", () => {
  const p = parseOpen("月～日: 9:00～20:00 （フードL.O. 19:00 ドリンクL.O. 19:30）");
  assert.equal(p.segments[0].loFoodMin, at(19, 0));
  assert.equal(p.segments[0].loDrinkMin, at(19, 30));
});

test("段内两个时段 → 合并成包络，status 仍 ok（有信息 note）", () => {
  const p = parseOpen("火～日: 11:30～15:00 17:30～21:00 （料理L.O. 14:00）（料理L.O. 20:30）");
  assert.equal(p.segments.length, 1);
  assert.equal(p.segments[0].openMin, at(11, 30));
  assert.equal(p.segments[0].closeMin, at(21, 0));
  // 多组括号时取最晚的 L.O.
  assert.equal(p.segments[0].loFoodMin, at(20, 30));
  assert.equal(p.status, "ok");
  assert.ok(p.notes.some((n) => n.includes("多时段")));
});

test("无括号 L.O. → 段里 loFoodMin 为 null，evaluate 时用闭店时间兜底", () => {
  const p = parseOpen("月～日: 11:00～22:00");
  assert.equal(p.segments[0].loFoodMin, null);
  const e = evaluateOpen(p, MON, at(19, 0), 60);
  assert.equal(e.lastOrderMin, at(22, 0));
  assert.equal(e.lastArrivalMin, at(21, 0));
});

test("24時間営業", () => {
  const p = parseOpen("24時間営業 年中無休");
  assert.equal(p.segments[0].openMin, 0);
  assert.equal(p.segments[0].closeMin, 1440);
  assert.deepEqual(p.segments[0].weekdays, [0, 1, 2, 3, 4, 5, 6]);
});

test("跨夜但无「翌」前缀 → 终点 +24h", () => {
  const p = parseOpen("月～日: 18:00～2:00 （料理L.O. 1:00）");
  assert.equal(p.segments[0].closeMin, 1440 + at(2, 0));
});

test("空字符串 → failed", () => {
  const p = parseOpen("");
  assert.equal(p.status, "failed");
  assert.equal(p.segments.length, 0);
});

test("完全无法解析 → failed", () => {
  const p = parseOpen("詳しくは店舗までお問い合わせください");
  assert.equal(p.status, "failed");
});

test("无曜日锚点但有单一时段", () => {
  const p = parseOpen("11:00～23:00（L.O.22:30）");
  assert.equal(p.segments.length, 1);
  assert.deepEqual(p.segments[0].weekdays, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(p.segments[0].loFoodMin, at(22, 30));
});

// ---------- evaluateOpen ----------

test("evaluate: 周五 19:00，营业到翌0:00，L.O. 23:30 → 可去", () => {
  const p = parseOpen(
    "月～木、日: 11:30～翌0:00 （料理L.O. 23:30）金、土: 11:30～翌3:00 （料理L.O. 翌2:30）",
  );
  const e = evaluateOpen(p, FRI, at(19, 0), 60);
  assert.equal(e.openAtTarget, true);
  assert.equal(e.lastOrderMin, 1440 + at(2, 30));
  assert.equal(e.lastArrivalMin, 1440 + at(2, 30) - 60);
});

test("evaluate: 周一 15:00，17:00 才开 → 未营业", () => {
  const p = parseOpen("月～金: 17:00～23:00 （料理L.O. 22:00）");
  const e = evaluateOpen(p, MON, at(15, 0), 60);
  assert.equal(e.openAtTarget, false);
});

test("evaluate: 目标那天没有排班 → unknown（降级为不过滤）", () => {
  const p = parseOpen("月～金: 17:00～23:00 （料理L.O. 22:00）");
  const e = evaluateOpen(p, SUN, at(19, 0), 60);
  assert.equal(e.openAtTarget, "unknown");
  assert.equal(e.lastArrivalMin, null);
});

test("evaluate: L.O. 前 30 分到店但已过 L.O.−余量 —— 仍在营业窗口内算 open", () => {
  // openAtTarget 只判断「是否在营业时段」；能否赶上 L.O. 由 pipeline 用 lastArrivalMin 决定
  const p = parseOpen("月～日: 17:00～23:00 （料理L.O. 22:00）");
  const e = evaluateOpen(p, MON, at(22, 30), 60);
  assert.equal(e.openAtTarget, true);
  assert.equal(e.lastArrivalMin, at(21, 0));
});

test("parseClose: 明确每周定休", () => {
  assert.deepEqual(parseClose("月曜日").closedWeekdays, [0]);
  assert.deepEqual(parseClose("火曜日").closedWeekdays, [1]);
  assert.deepEqual(parseClose("日曜・祝日").closedWeekdays, [6]);
});

test("parseClose: 不定休 / 第N週 → 不硬过滤", () => {
  assert.deepEqual(parseClose("不定休あり"), {
    raw: "不定休あり",
    closedWeekdays: [],
    irregular: true,
  });
  assert.equal(parseClose("第2・第4月曜").irregular, true);
  assert.deepEqual(parseClose("第2・第4月曜").closedWeekdays, []);
});

test("parseClose: 带例外说明的括号不误伤", () => {
  // 括号里「翌火曜休み」不该让周二被当成定休
  const c = parseClose("月曜（祝日の場合は営業、翌火曜休み）");
  assert.deepEqual(c.closedWeekdays, [0]);
});

test("parseClose: なし / 年末年始", () => {
  assert.deepEqual(parseClose("なし").closedWeekdays, []);
  assert.deepEqual(parseClose("年末年始").closedWeekdays, []);
  assert.equal(parseClose("").irregular, false);
});

test("evaluate: 定休日", () => {
  const p = parseOpen("火～日: 11:30～21:00 （料理L.O. 20:30）月: 定休日");
  const e = evaluateOpen(p, MON, at(19, 0), 60);
  assert.equal(e.openAtTarget, false);
  assert.equal(e.todayLabel, "定休日");
});
