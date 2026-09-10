import { test } from "node:test";
import assert from "node:assert/strict";
import { _resetGoogle, createGoogle } from "../_shared/google.ts";

function fakeFetch(routes: (url: string) => any): typeof fetch {
  return ((input: any) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = routes(url);
    return Promise.resolve({
      ok: body._status ? body._status < 400 : true,
      status: body._status ?? 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(""),
    } as Response);
  }) as typeof fetch;
}

test("未配置 key → enabled false", async () => {
  _resetGoogle();
  const g = createGoogle({});
  assert.equal(g.enabled, false);
  assert.equal(await g.geocode("東京"), null);
  assert.equal(await g.resolvePhoto("places/x/photos/y"), null);
});

test("geocode: 正常 + 缓存", async () => {
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
  assert.equal(a?.lat, 35.6912);
  await g.geocode("新宿区新宿3-38");
  assert.equal(calls, 1);
});

test("reverseGeocode: latlng 参数 + 缓存", async () => {
  _resetGoogle();
  let calls = 0;
  const g = createGoogle({
    key: "k",
    fetchImpl: fakeFetch((url) => {
      calls++;
      assert.match(url, /latlng=35\.6912/);
      return {
        status: "OK",
        results: [{
          geometry: { location: { lat: 35.6912, lng: 139.702 } },
          formatted_address: "東京都新宿区...",
        }],
      };
    }),
  });
  assert.ok(await g.reverseGeocode(35.6912, 139.702));
  await g.reverseGeocode(35.69121, 139.70201); // 同网格
  assert.equal(calls, 1);
});

test("resolvePhoto: 返回 photoUri", async () => {
  _resetGoogle();
  const g = createGoogle({
    key: "k",
    fetchImpl: fakeFetch((url) => {
      assert.match(url, /skipHttpRedirect=true/);
      return { photoUri: "https://lh3.googleusercontent.com/abc" };
    }),
  });
  assert.equal(
    await g.resolvePhoto("places/x/photos/y", 800),
    "https://lh3.googleusercontent.com/abc",
  );
});

test("当日计数熔断：geocode 超 dailyCap 后返回 null", async () => {
  _resetGoogle();
  let calls = 0;
  const g = createGoogle({
    key: "k",
    dailyCap: 2,
    fetchImpl: fakeFetch(() => {
      calls++;
      return { status: "ZERO_RESULTS", results: [] };
    }),
  });
  await g.geocode("a");
  await g.geocode("b");
  await g.geocode("c");
  assert.equal(calls, 2);
});
