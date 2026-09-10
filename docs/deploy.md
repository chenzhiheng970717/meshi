# 部署

后端 = Supabase Edge Function（`/search`、`/geocode`）。数据源 Google Places (New)。
前端 = 静态托管的 `prototype/index.html`，用 `?api=` 指向 Edge Function。

真实数据的前端地址（含 token）**不写进仓库** —— 避免被人找到刷 Google 配额。
演示版（GitHub Pages）没有后端，公开无所谓。

---

## 一、Google Cloud

1. 启用 **Places API (New)** 和 **Geocoding API**
2. **APIs & Services → Quotas** 逐个 API 设每日上限：
   - Places (New)：`SearchNearbyRequest per day` → **200**、`GetPhotoMediaRequest per day` → **300**，其余（SearchText / GetPlace / Autocomplete …）→ **1**
   - Geocoding：`requests per day` → **300**
3. **Credentials → API Key**，限制只用这两个 API
4. **Billing → Budgets** 设 $1 告警（拦不住钱，只是信号）

## 二、Edge Function → Supabase

```bash
export SUPABASE_ACCESS_TOKEN=<supabase.com/dashboard/account/tokens 生成>
npx supabase link --project-ref <ref>

npx supabase secrets set \
  GOOGLE_PLACES_API_KEY=<google key> \
  APP_TOKEN=$(openssl rand -hex 24)

npx supabase functions deploy search
```

函数地址：`https://<ref>.supabase.co/functions/v1/search`（`/geocode` 是同一函数的子路由）。
`supabase/config.toml` 里 `[functions.search] verify_jwt = false` —— 鉴权用 `X-App-Token`。

## 三、前端

**演示版**：`prototype/**` 改动 push 到 main → GitHub Actions 自动部署到
`https://<user>.github.io/meshi/`（演示数据）。

**真实数据**：演示版加参数，**存本地不外传**：

```
https://<user>.github.io/meshi/?api=https://<ref>.supabase.co/functions/v1/search&token=<APP_TOKEN>
```

首次打开写进 localStorage，之后直接开 `https://<user>.github.io/meshi/` 就带着。
`?api=off` 清掉、回演示数据。正式版（ADR：Cloudflare Pages + 自定义域名）另建前端项目，
`api` / `token` 走构建期环境变量注入。

---

## 硬约束回顾

- Google key / APP_TOKEN 只在 Supabase secret，不进仓库
- Places 调用全服务端 + 缓存 + 双熔断（Cloud 配额 + `google.ts` / `places.ts` 进程内当日计数）
- Google 数据：Place ID 可长期存，其它内容缓存 ≤30 天，不长期落库
- 展示 Google 数据的页面要有「Powered by Google」
- 游客可直接搜索
