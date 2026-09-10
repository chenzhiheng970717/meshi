// 本地开发服务器 —— 不需要 Deno / Supabase CLI。
//
//   npm run dev            # http://localhost:8787
//   POST /search           # 同 Edge Function 的契约
//   GET  /geocode?q=…      # 地址→坐标  /  ?lat=&lng= 反向
//   GET  /                 # 静态托管 prototype/
//
// 跑的是和 supabase/functions/search 完全相同的 ../_shared 管道（Google Places）。
// 设了 GOOGLE_PLACES_API_KEY 就打真实 API，否则走演示数据。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HttpError,
  normalizeRequest,
  runSearch,
} from "../supabase/functions/_shared/pipeline.ts";
import { createGoogle } from "../supabase/functions/_shared/google.ts";
import mockData from "../supabase/functions/_shared/mock/google-places.json" with {
  type: "json",
};

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROTOTYPE = join(ROOT, "prototype");
const MOCK = mockData.candidates;
const PORT = Number(process.env.PORT ?? 8787);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, x-app-token",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }

  const appToken = process.env.APP_TOKEN ?? "";
  const isApi = /^\/(search|geocode)/.test(url.pathname);
  if (appToken && isApi && req.headers["x-app-token"] !== appToken) {
    return send(res, 401, { error: "未授权" });
  }

  if (url.pathname.endsWith("/geocode")) {
    const g = createGoogle({ key: process.env.GOOGLE_PLACES_API_KEY });
    if (!g.enabled) return send(res, 501, { error: "地理编码未配置（GOOGLE_PLACES_API_KEY）" });
    const sp = url.searchParams;
    const hit = sp.has("lat") && sp.has("lng")
      ? await g.reverseGeocode(Number(sp.get("lat")), Number(sp.get("lng")))
      : await g.geocode(sp.get("q") ?? "");
    return hit ? send(res, 200, hit) : send(res, 404, { error: "解析不出这个位置" });
  }

  if (url.pathname.endsWith("/search")) {
    if (req.method !== "POST") return send(res, 405, { error: "只接受 POST" });
    try {
      const search = normalizeRequest(await readJson(req));
      const out = await runSearch(search, {
        env: { GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY },
        mockCandidates: MOCK,
      });
      return send(res, 200, out);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      return send(res, 500, { error: "内部错误" });
    }
  }

  // 静态托管 prototype/
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const path = normalize(join(PROTOTYPE, rel));
  if (!path.startsWith(PROTOTYPE)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const buf = await readFile(path);
    res.writeHead(200, {
      "content-type": MIME[extname(path)] ?? "application/octet-stream",
    }).end(buf);
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(PORT, () => {
  const mode = process.env.GOOGLE_PLACES_API_KEY ? "真实 Google Places" : "演示数据 (mock)";
  console.log(`meshi dev  →  http://localhost:${PORT}  [${mode}]`);
  console.log(`  原型:   http://localhost:${PORT}/?api=http://localhost:${PORT}`);
});

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new HttpError(400, "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}
function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...CORS })
    .end(JSON.stringify(body));
}
