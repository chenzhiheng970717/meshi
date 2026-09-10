import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeShops, nameCore } from "../_shared/dedupe.ts";
import type { Candidate } from "../_shared/places.ts";

function c(over: Partial<Candidate>): Candidate {
  return {
    id: "x",
    name: "店",
    address: "",
    lat: 35.69,
    lng: 139.70,
    primaryType: "restaurant",
    primaryTypeLabel: "",
    types: ["restaurant"],
    priceRange: null,
    priceLevel: null,
    rating: null,
    userRatingCount: null,
    hours: null,
    currentHours: null,
    mapsUri: "",
    reservable: null,
    photoName: null,
    ...over,
  };
}

test("nameCore 去分店后缀 / 车站方位 / 拉丁转写", () => {
  assert.equal(nameCore("四文銭 新宿東口店"), "四文銭");
  assert.equal(nameCore("四文銭 新宿東口本店"), "四文銭");
  assert.equal(nameCore("ビヤホールライオン 新宿店"), "ビヤホールライオン");
});

test("同坐标 + 名字主干相同 → 合并，留信息更全的", () => {
  const a = c({ id: "a", name: "四文銭 新宿東口店", lat: 35.69053, lng: 139.70207 });
  const b = c({
    id: "b",
    name: "四文銭 新宿東口本店",
    lat: 35.69053,
    lng: 139.70207,
    rating: 4.2,
    userRatingCount: 300,
    priceRange: { lo: 3000, hi: 4000 },
  });
  const out = dedupeShops([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "b");
});

test("同坐标但不同店 → 都保留", () => {
  const a = c({ id: "a", name: "ビヤホールライオン 新宿店", lat: 35.691, lng: 139.7024 });
  const b = c({ id: "b", name: "ワイン食堂 ブルマーレ 新宿店", lat: 35.691, lng: 139.7024 });
  assert.equal(dedupeShops([a, b]).length, 2);
});

test("同名异地（连锁分店）→ 都保留", () => {
  const a = c({ id: "a", name: "鳥貴族 新宿東口店", lat: 35.6912, lng: 139.702 });
  const b = c({ id: "b", name: "鳥貴族 新宿西口店", lat: 35.6899, lng: 139.6982 });
  assert.equal(dedupeShops([a, b]).length, 2);
});
