import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlaces, GENRE_TYPES, toCandidate, _resetPlaces } from "../_shared/places.ts";

test("toCandidate: 从 Google Place 提字段", () => {
  const c = toCandidate({
    id: "P1",
    displayName: { text: "炭火焼鳥 とり松" },
    shortFormattedAddress: "東京都新宿区新宿３丁目",
    location: { latitude: 35.6919, longitude: 139.7031 },
    primaryType: "japanese_izakaya_restaurant",
    primaryTypeDisplayName: { text: "居酒屋" },
    types: ["japanese_izakaya_restaurant", "bar", "restaurant"],
    priceRange: {
      startPrice: { currencyCode: "JPY", units: "3000" },
      endPrice: { currencyCode: "JPY", units: "4000" },
    },
    priceLevel: "PRICE_LEVEL_MODERATE",
    rating: 4.4,
    userRatingCount: 842,
    googleMapsUri: "https://maps.google.com/?cid=1",
    reservable: true,
    photos: [{ name: "places/P1/photos/AAA" }],
  });
  assert.equal(c?.name, "炭火焼鳥 とり松");
  assert.deepEqual(c?.priceRange, { lo: 3000, hi: 4000 });
  assert.equal(c?.rating, 4.4);
  assert.equal(c?.photoName, "places/P1/photos/AAA");
});

test("toCandidate: 只有 startPrice → 估上界", () => {
  const c = toCandidate({
    id: "P2",
    location: { latitude: 35, longitude: 139 },
    priceRange: { startPrice: { units: "10000" } },
  });
  assert.equal(c?.priceRange?.lo, 10000);
  assert.ok((c?.priceRange?.hi ?? 0) > 10000);
});

test("mock 客户端按半径筛", async () => {
  _resetPlaces();
  const p = createPlaces({
    mockCandidates: [
      toCandidate({ id: "near", location: { latitude: 35.6913, longitude: 139.7021 } })!,
      toCandidate({ id: "far", location: { latitude: 35.75, longitude: 139.75 } })!,
    ],
  });
  const out = await p.search({ lat: 35.6912, lng: 139.702, radiusM: 500, genres: [] });
  assert.deepEqual(out.map((c) => c.id), ["near"]);
});

test("GENRE_TYPES 覆盖前端 10 个 genre 码", () => {
  for (const g of ["G001", "G004", "G005", "G006", "G007", "G008", "G009", "G013", "G014", "G017"]) {
    assert.ok((GENRE_TYPES[g] ?? []).length > 0, g);
  }
});
