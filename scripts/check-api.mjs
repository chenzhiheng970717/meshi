// 拿到 HotPepper Key 后的第一次请求 —— 验证 key、看真实字段形态。
// 见 docs/data-sources.md「拿到 Key 后的第一次请求」。
//
//   npm run check:api
//
// 不打印 key，不打印带 key 的完整 URL。

const KEY = process.env.HOTPEPPER_API_KEY?.trim();
if (!KEY) {
  console.error("没有 HOTPEPPER_API_KEY。把 key 填进 .env 再跑。");
  process.exit(1);
}

const GOURMET = "https://webservice.recruit.co.jp/hotpepper/gourmet/v1/";
const GENRE = "https://webservice.recruit.co.jp/hotpepper/genre/v1/";
const BUDGET = "https://webservice.recruit.co.jp/hotpepper/budget/v1/";

async function call(base, params) {
  const u = new URL(base);
  u.searchParams.set("key", KEY);
  u.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const res = await fetch(u);
  const safeUrl = base + "?" + new URLSearchParams({ ...params, key: "***", format: "json" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} :: ${safeUrl}`);
  const json = await res.json();
  if (json?.results?.error) {
    throw new Error(JSON.stringify(json.results.error) + " :: " + safeUrl);
  }
  return json.results;
}

const uniq = (arr) => [...new Set(arr.filter((x) => x != null && x !== ""))];

console.log("== ジャンルマスタ / 予算マスタ ==");
const g = await call(GENRE, {});
const b = await call(BUDGET, {});
console.log(`genre 码表 ${g.genre.length} 条：`, g.genre.slice(0, 6).map((x) => `${x.code}=${x.name}`).join("  "), "…");
console.log(`budget 码表 ${b.budget.length} 条：`, b.budget.map((x) => `${x.code}=${x.name}`).join("  "));

console.log("\n== グルメサーチ：新宿駅東口 1km ==");
const probe = await call(GOURMET, { lat: 35.6912, lng: 139.702, range: 3, count: 5 });
console.log(`results_available = ${probe.results_available}  ← 候选池规模`);

const wide = await call(GOURMET, { lat: 35.6912, lng: 139.702, range: 3, count: 100 });
const shops = wide.shop ?? [];
console.log(`一页 count=100 实际拿到 ${shops.length} 家\n`);

console.log("== 字段审计（对照 docs/api-response.md 的假设）==");
console.log("card 出现值      :", uniq(shops.map((s) => s.card)));
console.log("non_smoking 出现值:", uniq(shops.map((s) => s.non_smoking)));
console.log("photo.pc keys    :", uniq(shops.flatMap((s) => Object.keys(s.photo?.pc ?? {}))));
console.log("photo.pc.l 例    :", shops.find((s) => s.photo?.pc?.l)?.photo.pc.l);
console.log("urls.pc 带 vos=  :", shops.slice(0, 3).every((s) => /vos=/.test(s.urls?.pc ?? "")), "  例:", shops[0]?.urls?.pc);
console.log("budget.average 例:", uniq(shops.map((s) => s.budget?.average)).slice(0, 6));
console.log("party_capacity 型:", uniq(shops.map((s) => typeof s.party_capacity)), " lat 型:", typeof shops[0]?.lat);
console.log("private_room 例  :", uniq(shops.map((s) => s.private_room)).slice(0, 3));
console.log("sub_genre 缺失数 :", shops.filter((s) => !s.sub_genre).length, "/", shops.length);

console.log("\n== open 字段样本（5 条）==");
for (const s of shops.slice(0, 5)) console.log(`· ${s.name}\n  open : ${s.open}\n  close: ${s.close}`);

console.log("\n完成。若 card / non_smoking / photo 尺寸 与文档假设不符，更新 docs/api-response.md 和相应解析。");
