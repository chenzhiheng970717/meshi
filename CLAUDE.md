# CLAUDE.md

东京餐厅推荐应用。用户输入出发地、就餐时间、交通方式、可接受路程时长、人数、口味、人均预算，返回排好序的五家店并说明推荐理由。

**当前阶段：M1 数据管道。** `/search` Edge Function 已部署到 Supabase，前端演示版在 GitHub Pages。
数据源正从 HotPepper 切到 Google Places（见 ADR-008）。

开工前先读 `docs/roadmap.md`（当前待办与待决策）和 `docs/decisions.md`（已定的架构决策，不要重新讨论）。

---

## 硬约束

违反这些会导致真实损失，优先级高于任何其他考虑。

**API Key 绝不进客户端、绝不进仓库。** Google key（Places + Geocoding 共用）和 `APP_TOKEN` 只存在于 Supabase Edge Function 的 secret 里。前端只调自己的 `/search`，带 `X-App-Token` 头。Key 进了 git 历史，删文件也没用——历史里还在，只能去 Cloud Console 重新生成。真实前端地址（含 token）不写进仓库。

**Google Places 配额熔断是硬要求。** 数据源就是 Google Places（ADR-008），`priceRange` / `rating` 都是 Enterprise 字段。两道熔断：① Cloud Console → Quotas 设每日请求数上限（SearchNearby / SearchText 100–300、GetPhotoMedia 300、Geocoding 300，其余压到 1）；② 代码里 `_shared/google.ts` 的进程内当日调用硬计数。预算告警只发邮件不阻断计费，配额才是熔断器。一个 `useEffect` 依赖写错就能烧掉四位数美元。

**Google 数据的缓存与署名。** Place ID 可长期存；其它内容（评分、营业时间、`priceRange`）缓存 ≤ 30 天。展示 Google 数据的页面要有「Powered by Google」。Postgres 只存用户、标记、常用地址（坐标 + 原始输入），不存店铺数据。

**游客必须能直接搜索。** 核心功能不得强制登录。这既是产品判断，也是将来做 iOS 时 App Store 条款 5.1.1(v) 的硬要求。

---

## 已定的技术选型

不要重新提议替代方案，理由都在 `docs/decisions.md`。

| 层 | 选择 |
|---|---|
| 平台 | 网页优先，iOS 壳等算法稳定后再加。微信小程序已排除 |
| 前端 | Vite + React（原型阶段是原生 HTML 单文件） |
| 店铺数据 | Google Places API (New) — Text/Nearby Search（ADR-008，取代 HotPepper）。带 `priceRange` 真实人均、结构化营业时间、评分 |
| 地理编码 | Google Geocoding（同一个 key，ADR-007） |
| 后端 | Supabase Edge Function（持 Key + 缓存 + 打分 + `X-App-Token` 鉴权） |
| 数据库 | Supabase Postgres |
| 认证 | Supabase Auth 邮箱 OTP + 匿名会话。**不做短信登录** |
| 地图 | MapLibre + 免费瓦片 |
| 部署 | Cloudflare Pages |

---

## 推荐算法

打分逻辑放服务端，改权重不用发版。

**硬过滤**：营业时间（`regularOpeningHours`，L.O. 提前 1 小时余量）、可达半径、`priceRange` 与用户预算区间重叠、口味（Google `primaryType` 命中）。

**人数不再硬过滤**（Google 无 `party_capacity`，见 ADR-008）：人数 ≥ 8 且店铺明显偏小时，推荐理由提示「大团请先电话确认」。包间标签去掉，`reservable` 作「可预约」弱替代。

**加权打分**：

```
score = 0.30·距离 + 0.25·口味 + 0.20·人气 + 0.15·预算 + 0.10·场景
```

**交通方式 → 可达半径**（`fixed` 是固定开销，应做成服务端可调参数）：

| 方式 | 公式 |
|---|---|
| 步行 | `T × 80 m/min` |
| 自行车 | `T × 250 m/min` |
| 电车 | `max(0, T − 12) × 400 m/min` |
| 驾车 | `max(0, T − 10) × 300 m/min` |

**候选池**：Google Nearby / Text Search 每页最多 20 条，翻页最多 3 页 = 60 条。半径无 3km 限制（上限 50km），不需要多中心点采样。目标半径 > ~5km 时用 Text Search + `locationBias`，否则 Nearby + `locationRestriction`。

**营业时间** 用 `regularOpeningHours`（结构化，`periods[]` + `weekdayDescriptions[]`），不用解析自由文本。`currentOpeningHours` 已含节假日调整。跨夜 period 的 `close.day` 会是次日。

**口味** 把用户选的分类映射到 Google `primaryType`（`ramen_restaurant` / `sushi_restaurant` / `izakaya`(用 `bar`+`japanese_restaurant` 近似) / `italian_restaurant` …）或 `includedType`。映射表见 `_shared/`。

---

## 视觉系统

参考方向是 MARLUND 那类餐饮站点：奶油底 + 浓咖啡色、压缩粗体大写标题、小字大写宽间距标签。改界面时保持这套，不要漂移。

```
浅色  --bg:#F4ECDF  --surface:#FCF8F1  --sunk:#EBE0CE
      --ink:#2B1F1A --ink-2:#6A5850    --ink-3:#9C8A7F
      --rule:#DDD1BE --rule-2:#C5B6A2
强调  --accent:#C0431D  --gold:#9C6D18  --green:#456638
深色带 --band:#2B1F1A  --band-ink:#F4ECDF
```

深色主题在 `prototype/index.html` 顶部同时定义了 `prefers-color-scheme` 和 `[data-theme]` 两套，改配色时两边都要动。

字体：标题 Anton（拉丁）、正文 Noto Sans SC、数字 DM Mono。圆角：卡片 6px、芯片 3px、开关药丸 999px。图标全部是文件里的内联 SVG symbol（`#i-pin`、`#i-clock` 等），不引外部图标库。

**原型是自包含单文件，不加载任何外部资源**（字体除外）。保持这个性质，它让原型可以直接双击打开。

---

## Git 约定

完整约定见 `docs/workflow.md`。

- `main` 不直接提交。走 `feat/xxx` 分支 + PR，哪怕只有一个人。
- 提交信息用 Conventional Commits：`feat(ui): 出发地支持门牌号输入`。范围用 `ui` / `score` / `api` / `auth` / `geo` / `data`。
- 正文写**为什么**这么改，不是改了什么——diff 已经说明改了什么。
- 提交前用 `git add -p` 分块暂存，能拦下顺手写的调试代码。
- 版本标签遵循语义化版本，原型阶段停在 `0.x`。接通真实数据并跑通端到端时发 `1.0.0`。

---

## 待决策问题 —— 不要擅自决定

需要产品方拍板，遇到时问，别自己选一个然后往下写。

1. ~~评分数据来源~~ —— 已定：Google Places（ADR-004 / ADR-008）。
2. **「就这家 → 吃过 → 评价」的闭环。** 现在两个标记独立。可能做成时间触发：就餐时间过后提示「今晚去了 XX 吗？」，自动标记吃过并请求打分。是否要做时间触发提示未定。
3. ~~矢量插画兜底~~ —— 已定：正式版用真实照片（Google `photos`），无照片的店保留插画。
4. **人数输入怎么处理**（ADR-008）：Google 无 `party_capacity`。当前决定是降级为软提示。是否干脆从表单去掉「人数」这个输入，待定。

---

## 常用命令

```bash
# 本地起后端 + 静态托管原型（无需 Deno / Supabase CLI）
npm run dev          # http://localhost:8787，读 .env
npm test             # 单元测试
npm run check:api    # 有 key 时审计真实 API 字段

# 部署 Edge Function（.env 里要有 SUPABASE_ACCESS_TOKEN）
npx supabase functions deploy search

# 看历史
git log --oneline --graph --decorate -20

# 回退
git revert <commit>                        # 已推送的，生成反向提交
git checkout v0.2.0 -- prototype/index.html # 只找回某个文件的旧版本
```
