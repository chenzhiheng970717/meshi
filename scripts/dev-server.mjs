// 本地开发服务器 —— 不需要 Deno / Supabase CLI。
//
//   npm run dev            # 起在 http://localhost:8787
//   POST /search           # 同 Edge Function 的契约
//   GET  /                 # 把 prototype/ 静态托管，方便端到端点
//
// 跑的是和 supabase/functions/search 完全相同的 ../_shared 管道。
// 设了 HOTPEPPER_API_KEY 环境变量就打真实 API，否则走演示数据。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HttpError,
  normalizeRequest,
  runSearch,
} from "../supabase/functions/_shared/pipeline.ts";
import { getMasters } from "../supabase/functions/_shared/master.ts";
import { createGoogle } from "../supabase/functions/_shared/google.ts";
import mockData from "../supabase/functions/_shared/mock/gourmet-shops.json" with { type: "json" };

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROTOTYPE = join(ROOT, "prototype");
const MOCK_SHOPS = mockData.shop;
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
  if (appToken && url.pathname !== "/" && !url.pathname.match(/\.(html|js|css|svg)$/) &&
      req.headers["x-app-token"] !== appToken) {
    return send(res, 401, { error: "未授权" });
  }

  if (url.pathname === "/masters") {
    const m = await getMasters(process.env.HOTPEPPER_API_KEY);
    return send(res, 200, { genres: m.genres, budgets: m.budgets, source: m.source });
  }

  if (url.pathname === "/geocode" || url.pathname === "/search/geocode") {
    const g = createGoogle({ key: process.env.GOOGLE_PLACES_API_KEY });
    if (!g.enabled) return send(res, 501, { error: "地理编码未配置（GOOGLE_PLACES_API_KEY）" });
    const sp = url.searchParams;
    const hit = sp.has("lat") && sp.has("lng")
      ? await g.reverseGeocode(Number(sp.get("lat")), Number(sp.get("lng")))
      : await g.geocode(sp.get("q") ?? "");
    return hit ? send(res, 200, hit) : send(res, 404, { error: "解析不出这个位置" });
  }

  if (url.pathname === "/search") {
    if (req.method !== "POST") {
      return send(res, 405, { error: "只接受 POST" });
    }
    try {
      const body = await readJson(req);
      const search = normalizeRequest(body);
      const out = await runSearch(search, {
        env: {
          HOTPEPPER_API_KEY: process.env.HOTPEPPER_API_KEY,
          GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
        },
        mockShops: MOCK_SHOPS,
      });
      return send(res, 200, out);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      return send(res, 500, { error: "内部错误" });
    }
  }

  // 静态托管 prototype/
  let rel = url.pathname === "/" ? "/index.html" : url.pathname;
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
  const mode = (process.env.HOTPEPPER_API_KEY ? "真实 HotPepper" : "演示数据 (mock)") +
    (process.env.GOOGLE_PLACES_API_KEY ? " + Google 评分/地理编码" : "");
  console.log(`meshi dev  →  http://localhost:${PORT}  [${mode}]`);
  console.log(`  原型:   http://localhost:${PORT}/?api=http://localhost:${PORT}`);
  console.log(`  接口:   POST http://localhost:${PORT}/search`);
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
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...CORS,
  }).end(JSON.stringify(body));
}
