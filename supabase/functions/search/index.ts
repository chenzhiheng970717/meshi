// Supabase Edge Function：/search（POST）、/geocode（GET）
//
// 数据源 = Google Places (New)（ADR-008）。key 在 Supabase secret，绝不进前端。
// 本地调试无需 Deno：`npm run dev`。
//
// secret：GOOGLE_PLACES_API_KEY / APP_TOKEN
//   - 未设 GOOGLE_PLACES_API_KEY → 走演示数据
//   - 设了 APP_TOKEN → 请求必须带 X-App-Token 头且匹配

import { HttpError, normalizeRequest, runSearch } from "../_shared/pipeline.ts";
import { createGoogle } from "../_shared/google.ts";
import type { Candidate } from "../_shared/places.ts";
import mockData from "../_shared/mock/google-places.json" with { type: "json" };

const MOCK: Candidate[] = (mockData as { candidates: Candidate[] }).candidates;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, x-app-token",
};

// deno-lint-ignore no-explicit-any
const Deno: any = (globalThis as any).Deno;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const appToken = Deno.env.get("APP_TOKEN") ?? "";
  if (appToken && req.headers.get("x-app-token") !== appToken) {
    return json({ error: "未授权" }, 401);
  }

  const gkey = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? undefined;
  const path = new URL(req.url).pathname;

  // GET /geocode?q=<地址>  或  ?lat=&lng=（反向）
  if (req.method === "GET" && path.endsWith("/geocode")) {
    const sp = new URL(req.url).searchParams;
    const g = createGoogle({ key: gkey });
    if (!g.enabled) return json({ error: "地理编码未配置" }, 501);
    const hit = sp.has("lat") && sp.has("lng")
      ? await g.reverseGeocode(Number(sp.get("lat")), Number(sp.get("lng")))
      : await g.geocode(sp.get("q") ?? "");
    if (!hit) return json({ error: "解析不出这个位置" }, 404);
    return json(hit, 200, { "Cache-Control": "public, max-age=86400" });
  }

  if (req.method !== "POST") return json({ error: "只接受 POST" }, 405);

  try {
    const search = normalizeRequest(await req.json());
    const res = await runSearch(search, {
      env: { GOOGLE_PLACES_API_KEY: gkey },
      mockCandidates: MOCK,
    });
    return json(res, 200, { "Cache-Control": "public, max-age=600" });
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
