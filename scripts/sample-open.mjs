// 抽真实 open / close 字段存成 fixture，供人工看格式 + 跑解析器覆盖率。
// 见 CLAUDE.md：「写解析器之前先抽 100 条真实数据人工看格式，别凭想象写正则。」
//
//   npm run sample:open
//
// 产出 fixtures/open-strings.json，并打印当前解析器的覆盖情况。

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseOpen, parseClose, evaluateOpen } from "../supabase/functions/_shared/openHours.ts";

const KEY = process.env.HOTPEPPER_API_KEY?.trim();
if (!KEY) {
  console.error("没有 HOTPEPPER_API_KEY。把 key 填进 .env 再跑。");
  process.exit(1);
}

const GOURMET = "https://webservice.recruit.co.jp/hotpepper/gourmet/v1/";
// 覆盖不同商圈，格式差异更全
const CENTERS = [
  ["新宿", 35.6912, 139.7020],
  ["渋谷", 35.6595, 139.7005],
  ["東京駅", 35.6812, 139.7671],
  ["池袋", 35.7295, 139.7109],
  ["恵比寿", 35.6467, 139.7100],
  ["六本木", 35.6628, 139.7315],
  ["吉祥寺", 35.7030, 139.5800],
  ["上野", 35.7138, 139.7770],
];
const TARGET = 150;

async function call(params) {
  const u = new URL(GOURMET);
  u.searchParams.set("key", KEY);
  u.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const res = await fetch(u);
  if (!res.ok) throw new Error(`HotPepper ${res.status}`);
  const json = await res.json();
  if (json?.results?.error) throw new Error(JSON.stringify(json.results.error));
  return json.results.shop ?? [];
}

const PER_AREA = Math.ceil(TARGET / CENTERS.length) + 4;
const byId = new Map();
for (const [name, lat, lng] of CENTERS) {
  let added = 0;
  // 从多页里翻，跨过前面的广告位，格式更杂
  for (const start of [1, 101, 201]) {
    if (added >= PER_AREA) break;
    const shops = await call({ lat, lng, range: 3, count: 100, start });
    for (const s of shops) {
      if (added >= PER_AREA) break;
      if (!byId.has(s.id)) {
        byId.set(s.id, {
          id: s.id,
          name: s.name,
          area: name,
          genre: s.genre?.name,
          open: s.open ?? "",
          close: s.close ?? "",
        });
        added++;
      }
    }
    if (shops.length < 100) break;
  }
  console.log(`${name}: +${added}（累计 ${byId.size}）`);
}

const rows = [...byId.values()];
const outDir = fileURLToPath(new URL("../fixtures/", import.meta.url));
await mkdir(outDir, { recursive: true });
await writeFile(outDir + "open-strings.json", JSON.stringify(rows, null, 2) + "\n");
console.log(`\n写入 fixtures/open-strings.json（${rows.length} 条）`);

// --- 当前解析器覆盖率 ---
const when = new Date("2026-09-11T19:00"); // 金曜 19:00
let ok = 0, partial = 0, failed = 0, empty = 0, evalOk = 0, evalUnknown = 0;
const problems = [];
for (const r of rows) {
  if (!r.open.trim()) { empty++; continue; }
  const p = parseOpen(r.open);
  if (p.status === "ok") ok++;
  else if (p.status === "partial") partial++;
  else { failed++; problems.push(r); }
  const e = evaluateOpen(p, when, 19 * 60, 60);
  if (e.openAtTarget === "unknown") evalUnknown++;
  else evalOk++;
}
const n = rows.length;
console.log(`\n解析 status：ok ${ok} / partial ${partial} / failed ${failed} / 空 ${empty}  （共 ${n}）`);
console.log(`L0+L1 覆盖率：${(((ok + partial) / (n - empty)) * 100).toFixed(1)}%  （目标 ≥ 85%，不达标先改正则再接主流程）`);
console.log(`金曜19:00 判定：可判定 ${evalOk} / unknown(降级) ${evalUnknown}`);
if (problems.length) {
  console.log(`\nfailed 样本（人工看）：`);
  for (const r of problems.slice(0, 15)) console.log(`  [${r.area}] ${r.name}\n    ${r.open}`);
}
