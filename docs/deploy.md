# 部署

后端 = Supabase Edge Function（`/search` `/geocode` `/masters`）。
前端 = 静态托管的 `prototype/index.html`，用 `?api=` 指向 Edge Function。

真实数据的前端地址**不写进仓库**（README / 描述 / 任何提交的文件都不放），
避免被人找到刷配额。演示版（GitHub Pages）没有后端，公开无所谓。

---

## 一、Edge Function → Supabase

### 准备（一次）

1. supabase.com 注册，新建项目，region 选 **Northeast Asia (Tokyo)**
2. 记下 **project ref**（dashboard URL 里 `project/<ref>` 的那段）
3. supabase.com/dashboard/account/tokens 生成一个 **access token**

### 部署

```bash
export SUPABASE_ACCESS_TOKEN=<access token>
npx supabase link --project-ref <ref>

# secret（值发给 Supabase，不进仓库）
npx supabase secrets set \
  HOTPEPPER_API_KEY=<hotpepper key> \
  GOOGLE_PLACES_API_KEY=<google key> \
  APP_TOKEN=$(openssl rand -hex 24)

npx supabase functions deploy search
```

函数地址：`https://<ref>.supabase.co/functions/v1/search`
（`/geocode` `/masters` 是同一个函数按路径分的，基址是 `.../functions/v1`）

`supabase/config.toml` 里 `[functions.search] verify_jwt = false` —— 鉴权用我们
自己的 `X-App-Token`，不走 Supabase JWT。

### Google Cloud 侧

Edge Function 部署后，把 Supabase 的出口 IP 加进 Google API Key 的
Application restrictions（或先留空，靠 `APP_TOKEN` + 每日配额兜着）。

---

## 二、前端

### 演示版（已上线，无需操作）

`prototype/**` 一改动 push 到 main，GitHub Actions 自动部署到
`https://<user>.github.io/meshi/`（演示数据）。

### 真实数据

演示版加参数即可，**存本地不外传**：

```
https://<user>.github.io/meshi/?api=https://<ref>.supabase.co/functions/v1&token=<APP_TOKEN>
```

`?api=` 和 `?token=` 首次打开会写进 localStorage，之后直接开
`https://<user>.github.io/meshi/` 就带着。`token` 会立刻从地址栏擦掉（不留历史）。
`?api=off` 清掉、回到演示数据。

正式版（ADR：Cloudflare Pages + 自定义域名）再单独建一个前端项目，
把 `api` / `token` 通过构建期环境变量注入，不硬编码。

---

## 硬约束回顾

- key（HotPepper / Google / APP_TOKEN）只在 Supabase secret，不进仓库
- Places 调用全服务端 + 24h 缓存 + 双熔断（Cloud 配额 + 进程内当日计数）
- HotPepper 数据不落库
- 页脚署名不可移除；游客可直接搜索
