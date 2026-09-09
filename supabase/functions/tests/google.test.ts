import { test } from "node:test";
import assert from "node:assert/strict";
import { createGoogle, _resetGoogle } from "../_shared/google.ts";

function fakeFetch(routes: (url: string, init?: any) => any): typeof fetch {
  return ((input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = routes(url, init);
    return Promise.resolve({
      ok: body._status ? body._status < 400 : true,
      status: body._status ?? 200,
      json: () => Promise.resolve(body),
    } as Response);
  }) as typeof fetch;
}

test("未配置 key → enabled false，调用返回空", async () => {
  _resetGoogle();
  const g = createGoogle({});
  assert.equal(g.enabled, false);
  assert.equal(await g.geocode("東京都新宿区"), null);
  assert.equal((await g.ratingsFor([{ id: "a", name: "x", lat: 35, lng: 139 }])).size, 0);
});

test("geocode: 正常解析 + 缓存（第二次不再请求）", async () => {
  _resetGoogle();
  let calls = 0;
  const g = createGoogle({
    key: "k",
    fetchImpl: fakeFetch(() => {
      calls++;
      return {
        status: "OK",
        results: [{
          geometry: { location: { lat: 35.6912, lng: 139.702 } },
          formatted_address: "日本、〒160-0022 東京都新宿区新宿３丁目",
        }],
      };
    }),
  });
  const a = await g.geocode("新宿区新宿3-38");
  assert.deepEqual(a, {
    lat: 35.6912,
    lng: 139.702,
    formatted: "日本、〒160-0022 東京都新宿区新宿３丁目",
  });
  await g.geocode("新宿区新宿3-38");
  assert.equal(calls, 1, "第二次应命中缓存");
});

test("geocode: ZERO_RESULTS → null（也缓存）", async () => {
  _resetGoogle();
  const g = createGoogle({
    key: "k",
    fetchImpl: fakeFetch(() => ({ status: "ZERO_RESULTS", results: [] })),
  });
  assert.equal(await g.geocode("かきくけこ"), null);
});

test("ratingsFor: 250m 内取最近，返回 rating", async () => {
  _resetGoogle();
  const g = createGoogle({
    key: "k",
    fetchImpl: fakeFetch(() => ({
      places: [
        {
          id: "far",
          location: { latitude: 35.70, longitude: 139.70 },
          rating: 3.0,
          userRatingCount: 10,
        },
        {
          id: "near",
          displayName: { text: "とりまる" },
          location: { latitude: 35.6913, longitude: 139.7021 },
          rating: 4.3,
          userRatingCount: 842,
          googleMapsUri: "https://maps.google.com/?cid=1",
        },
      ],
    })),
  });
  const out = await g.ratingsFor([
    { id: "s1", name: "炭火焼鳥 とりまる", lat: 35.6912, lng: 139.702 },
  ]);
  assert.equal(out.get("s1")?.rating, 4.3);
  assert.equal(out.get("s1")?.userRatingCount, 842);
});

test("ratingsFor: 最近的也在 250m 外 → 不返回（宁缺毋滥）", async () => {
  _resetGoogle();
  const g = createGoogle({
    key: "k",
    fetchImpl: fakeFetch(() => ({
      places: [{
        id: "x",
        location: { latitude: 35.70, longitude: 139.71 },
        rating: 4.9,
        userRatingCount: 5,
      }],
    })),
  });
  const out = await g.ratingsFor([{ id: "s1", name: "某店", lat: 35.6912, lng: 139.702 }]);
  assert.equal(out.size, 0);
});

test("当日计数熔断：超过 dailyCap 后不再请求", async () => {
  _resetGoogle();
  let calls = 0;
  const g = createGoogle({
    key: "k",
    dailyCap: 2,
    fetchImpl: fakeFetch(() => {
      calls++;
      return { places: [] }; // 没命中，但请求已发出
    }),
  });
  const shops = [1, 2, 3, 4].map((n) => ({
    id: "s" + n,
    name: "店" + n,
    lat: 35.6912,
    lng: 139.702,
  }));
  await g.ratingsFor(shops);
  assert.equal(calls, 2, "第 3 个起被熔断");
});

test("Places 500 → 该店返回 null，不抛", async () => {
  _resetGoogle();
  const g = createGoogle({
    key: "k",
    fetchImpl: fakeFetch(() => ({ _status: 500, error: "boom" })),
  });
  const out = await g.ratingsFor([{ id: "s1", name: "x", lat: 35, lng: 139 }]);
  assert.equal(out.size, 0);
});
