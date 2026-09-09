// Supabase Edge Function: POST /search
//
// 持 HotPepper Key（环境变量，绝不进前端）+ 缓存 + 打分。见 ADR-005。
// 业务逻辑全在 ../_shared/*，本文件只做 HTTP 壳。
// 本地调试无需 Deno：`npm run dev` 会用 scripts/dev-server.mjs 跑同一条管道。
//
// 部署：supabase functions deploy search
// 环境变量：supabase secrets set HOTPEPPER_API_KEY=xxxx
//   未设 key 时自动走演示数据（mock），方便先联调前端。

import {
  HttpError,
  normalizeRequest,
  runSearch,
} from "../_shared/pipeline.ts";
import { getMasters } from "../_shared/master.ts";
import { createGoogle } from "../_shared/google.ts";
import type { RawShop } from "../_shared/hotpepper.ts";
import mockData from "../_shared/mock/gourmet-shops.json" with { type: "json" };

const MOCK_SHOPS = (mockData as { shop: RawShop[] }).shop;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

// deno-lint-ignore no-explicit-any
const Deno: any = (globalThis as any).Deno;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const key = Deno.env.get("HOTPEPPER_API_KEY") ?? undefined;
  const gkey = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? undefined;
  const path = new URL(req.url).pathname;

  if (req.method === "GET" && path.endsWith("/masters")) {
    const m = await getMasters(key);
    return json({ genres: m.genres, budgets: m.budgets, source: m.source }, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  }

  // GET /geocode?q=<地址> → { lat, lng, formatted } | 404
  if (req.method === "GET" && path.endsWith("/geocode")) {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    const g = createGoogle({ key: gkey });
    if (!g.enabled) return json({ error: "地理编码未配置" }, 501);
    const hit = await g.geocode(q);
    if (!hit) return json({ error: "解析不出这个地址" }, 404);
    return json(hit, 200, { "Cache-Control": "public, max-age=86400" });
  }

  if (req.method !== "POST") {
    return json({ error: "只接受 POST" }, 405);
  }

  try {
    const body = await req.json();
    const search = normalizeRequest(body);
    const res = await runSearch(search, {
      env: { HOTPEPPER_API_KEY: key, GOOGLE_PLACES_API_KEY: gkey },
      mockShops: MOCK_SHOPS,
    });
    return json(res, 200, {
      // 缓存 ≤ 24h（Recruit 条款）。这里给 CDN / 浏览器一个短缓存。
      "Cache-Control": "public, max-age=600",
    });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "内部错误" }, 500);
  }
});

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}
