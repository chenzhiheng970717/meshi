import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRequest, runSearch } from "../_shared/pipeline.ts";
import { _resetPlaces, type Candidate } from "../_shared/places.ts";
import { _resetGoogle } from "../_shared/google.ts";
import mockData from "../_shared/mock/google-places.json" with { type: "json" };

const MOCK: Candidate[] = (mockData as { candidates: Candidate[] }).candidates;
const ORIGIN = { lat: 35.6912, lng: 139.702, label: "新宿駅 東口" };

function req(over: Record<string, unknown> = {}) {
  return normalizeRequest({
    origin: ORIGIN,
    datetime: "2026-09-11T19:00", // 金曜
    transport: "walk",
    maxMinutes: 25,
    party: 2,
    genres: [],
    budgetMin: 2000,
    budgetMax: 5000,
    ...over,
  });
}

test("端到端：mock 模式返回排好序的结果", async () => {
  _resetPlaces();
  _resetGoogle();
  const res = await runSearch(req(), { mockCandidates: MOCK });
  assert.equal(res.source, "mock");
  assert.ok(res.results.length > 0 && res.results.length <= 5);
  for (let i = 1; i < res.results.length; i++) {
    assert.ok(res.results[i - 1].score >= res.results[i].score);
  }
  assert.match(res.attribution.text, /Google/);
  // 人气分来自真实 rating
  assert.ok(res.results[0].rating != null);
});

test("步行 15 分钟把远处的店过滤掉", async () => {
  _resetPlaces();
  const res = await runSearch(req({ maxMinutes: 15 }), { mockCandidates: MOCK });
  // 丸の内 / 渋谷 的店不该出现在新宿步行圈里
  assert.ok(!res.results.some((r) => /グリル春日|ハヌル|白樺/.test(r.name)));
});

test("口味过滤：只要拉面", async () => {
  _resetPlaces();
  const res = await runSearch(
    req({ genres: ["G013"], maxMinutes: 30, budgetMin: 500, budgetMax: 3000 }),
    { mockCandidates: MOCK },
  );
  assert.ok(res.results.length > 0);
  assert.ok(res.results.every((r) => /ramen/.test(r.genre.type) || r.name.includes("そば")));
});

test("预算：¥1000–2000 排除高价店", async () => {
  _resetPlaces();
  const res = await runSearch(
    req({ budgetMin: 1000, budgetMax: 2000, maxMinutes: 30 }),
    { mockCandidates: MOCK },
  );
  assert.ok(res.rejected.budget > 0);
  assert.ok(!res.results.some((r) => r.name.includes("かねさだ"))); // ¥10000-15000
});

test("周一午餐：只晚市的店被小时过滤", async () => {
  _resetPlaces();
  const res = await runSearch(
    req({ datetime: "2026-09-14T12:30", maxMinutes: 20 }),
    { mockCandidates: MOCK },
  );
  // 「炭火焼鳥 とり松」只有 17:00 之后 → 中午不营业
  assert.ok(!res.results.some((r) => r.name.includes("とり松")));
  // 「蕎麦切り 花見月」有午市 → 应能出现
  assert.ok(res.rejected.hours > 0);
});

test("exclude / disliked 生效", async () => {
  _resetPlaces();
  const base = await runSearch(req({ maxMinutes: 30 }), { mockCandidates: MOCK });
  const topId = base.results[0].id;
  const res = await runSearch(req({ maxMinutes: 30, disliked: [topId] }), {
    mockCandidates: MOCK,
  });
  assert.ok(!res.results.some((r) => r.id === topId));
  assert.ok(res.rejected.disliked >= 1);
});

test("分批：batch 1 与 batch 0 不重叠", async () => {
  _resetPlaces();
  const p0 = await runSearch(req({ maxMinutes: 40, budgetMin: 500, budgetMax: 20000 }), {
    mockCandidates: MOCK,
  });
  if (p0.batches < 2) return;
  const p1 = await runSearch(
    req({ maxMinutes: 40, budgetMin: 500, budgetMax: 20000, batch: 1 }),
    { mockCandidates: MOCK },
  );
  const overlap = p0.results.filter((a) => p1.results.some((b) => b.id === a.id));
  assert.equal(overlap.length, 0);
});

test("normalizeRequest 校验：缺坐标报 400", () => {
  assert.throws(() => normalizeRequest({ datetime: "2026-09-11T19:00", origin: {} }), /origin/);
});
