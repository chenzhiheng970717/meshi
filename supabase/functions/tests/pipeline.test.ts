import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRequest, runSearch } from "../_shared/pipeline.ts";
import { _resetGoogle } from "../_shared/google.ts";
import type { RawShop } from "../_shared/hotpepper.ts";
import mockData from "../_shared/mock/gourmet-shops.json" with { type: "json" };

const MOCK_SHOPS = (mockData as { shop: RawShop[] }).shop;
// 新宿駅東口
const ORIGIN = { lat: 35.6912, lng: 139.702, label: "新宿駅 東口" };

function req(over: Record<string, unknown> = {}) {
  return normalizeRequest({
    origin: ORIGIN,
    datetime: "2026-09-11T19:00", // 金曜
    transport: "walk",
    maxMinutes: 20,
    party: 2,
    genres: [],
    budgetMin: 2000,
    budgetMax: 5000,
    ...over,
  });
}

test("端到端：mock 模式返回排好序的结果", async () => {
  const res = await runSearch(req(), { mockShops: MOCK_SHOPS });
  assert.equal(res.source, "mock");
  assert.ok(res.results.length > 0);
  assert.ok(res.results.length <= 5);
  // 降序
  for (let i = 1; i < res.results.length; i++) {
    assert.ok(res.results[i - 1].score >= res.results[i].score);
  }
  // 署名字段在
  assert.match(res.attribution.text, /ホットペッパー/);
  // vos= 追踪参数原样透传
  assert.match(res.results[0].url, /vos=/);
});

test("步行 20 分钟把远处的店过滤掉", async () => {
  const res = await runSearch(req({ maxMinutes: 20 }), { mockShops: MOCK_SHOPS });
  // 六本木 / 池袋 / 銀座 的店不该出现在新宿步行圈里
  const names = res.results.map((r) => r.name).join(",");
  assert.ok(!names.includes("六本木"));
  assert.ok(!names.includes("池袋"));
});

test("人数过滤：8 人排除只能坐 2 的拉面店", async () => {
  const res = await runSearch(req({ party: 8, maxMinutes: 25 }), {
    mockShops: MOCK_SHOPS,
  });
  assert.ok(!res.results.some((r) => r.id === "J_MOCK_003"));
  assert.ok(res.rejected.capacity > 0);
});

test("口味过滤：只要拉面", async () => {
  const res = await runSearch(
    req({ genres: ["G013"], maxMinutes: 30, budgetMin: 1000, budgetMax: 2000 }),
    { mockShops: MOCK_SHOPS },
  );
  assert.ok(res.results.length > 0);
  assert.ok(res.results.every((r) => r.genre.code === "G013"));
});

test("周一午餐：只在周一午市营业的店应通过，仅晚市的被小时过滤", async () => {
  const res = await runSearch(
    req({ datetime: "2026-09-07T12:30", maxMinutes: 15 }),
    { mockShops: MOCK_SHOPS },
  );
  // 花見月 周一定休 → 不出现
  assert.ok(!res.results.some((r) => r.id === "J_MOCK_002"));
  // のぐち 周一 16:00 开 → 12:30 不营业
  assert.ok(!res.results.some((r) => r.id === "J_MOCK_004"));
});

test("exclude / disliked 生效", async () => {
  const base = await runSearch(req({ maxMinutes: 25 }), { mockShops: MOCK_SHOPS });
  const topId = base.results[0].id;
  const res = await runSearch(
    req({ maxMinutes: 25, disliked: [topId] }),
    { mockShops: MOCK_SHOPS },
  );
  assert.ok(!res.results.some((r) => r.id === topId));
  assert.ok(res.rejected.disliked >= 1);
});

test("分页：batch 1 返回后 5 家", async () => {
  const p1 = await runSearch(req({ maxMinutes: 30, batch: 0, budgetMin: 1000, budgetMax: 15000 }), {
    mockShops: MOCK_SHOPS,
  });
  if (p1.batches < 2) return; // 数据不够两页就跳过
  const p2 = await runSearch(req({ maxMinutes: 30, batch: 1, budgetMin: 1000, budgetMax: 15000 }), {
    mockShops: MOCK_SHOPS,
  });
  const overlap = p1.results.filter((a) => p2.results.some((b) => b.id === a.id));
  assert.equal(overlap.length, 0);
});

test("营业时间无法解析 → 不过滤并在 notes / 卡片标注", async () => {
  const weird: RawShop[] = [{
    ...MOCK_SHOPS[0],
    id: "J_WEIRD",
    name: "謎の営業時間",
    open: "営業時間はお店にご確認ください",
    lat: 35.6913,
    lng: 139.7022,
  }];
  const res = await runSearch(req(), { mockShops: weird });
  const hit = res.results.find((r) => r.id === "J_WEIRD");
  assert.ok(hit, "解析失败的店仍应出现");
  assert.equal(hit!.hours.disclaimer, true);
  assert.ok(res.notes.some((n) => n.includes("营业时间")));
});

test("Google 评分只补返回的这一批，命中的写进 rating", async () => {
  _resetGoogle();
  const gfetch = ((input, init) => {
    const url = String(input);
    if (url.includes("places:searchText")) {
      const q = JSON.parse(init.body).textQuery;
      // 给 J_MOCK_001 一个匹配（坐标落在其 400m 内），其余不匹配
      const near = q.includes("とりまる");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          places: near
            ? [{
              id: "g1",
              location: { latitude: 35.6919, longitude: 139.7031 },
              rating: 4.4,
              userRatingCount: 1200,
              googleMapsUri: "https://maps.google.com/x",
            }]
            : [],
        }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  }) as typeof fetch;

  const res = await runSearch(req({ maxMinutes: 25 }), {
    mockShops: MOCK_SHOPS,
    env: { GOOGLE_PLACES_API_KEY: "k" },
    googleFetch: gfetch,
  });
  const hit = res.results.find((r) => r.id === "J_MOCK_001");
  assert.ok(hit);
  assert.equal(hit.rating, 4.4);
  assert.equal(hit.userRatingCount, 1200);
  assert.equal(hit.ratingSource, "google");
  // 没命中的保持 null
  assert.ok(res.results.some((r) => r.rating === null));
  assert.ok(res.notes.some((n) => n.includes("Google 评分")));
});

test("normalizeRequest 校验：缺坐标报 400", () => {
  assert.throws(
    () => normalizeRequest({ datetime: "2026-09-11T19:00", origin: {} }),
    /origin/,
  );
});
