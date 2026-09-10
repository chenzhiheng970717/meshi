<div align="center">

# MESHI 🍜

**东京餐厅推荐 — 按时间、位置、预算和口味，挑出真正合适的五家**

[![Prototype](https://img.shields.io/badge/prototype-v0.3-C0431D)](prototype/index.html)
[![Stage](https://img.shields.io/badge/stage-M1%20data%20pipeline-9C6D18)](docs/roadmap.md)
[![License](https://img.shields.io/badge/license-MIT-456638)](LICENSE)

</div>

---

## 这是什么

输入**出发地、就餐时间、交通方式、可接受的路程时长、人数、口味、人均预算**，MESHI 从东京的餐厅里筛出符合条件的，按规则打分排序，每次给你五家，并且**说明为什么推荐它们**。

不是又一个大众点评。区别在三点：

1. **约束求解，不是浏览。** 你给的是硬条件（6 个人、19:00、步行 15 分钟内、人均 4000 日元以内、想吃烤肉），它给的是能立刻定下来的答案。
2. **推荐理由可解释。** 每家店下面写清楚「步行 4 分钟 · 人均 ¥3,500 正好在预算内 · 有 6 人包间」。排序逻辑是透明的加权打分，不是黑箱。
3. **记住你的口味。** 标记「吃过 / 喜欢 / 不喜欢」，不喜欢的不再出现，可以只看喜欢的、排除吃过的。

## 当前状态

**M1 数据管道。** `/search` Edge Function 已上线（Supabase），前端演示版在 GitHub Pages，数据源 Google Places。

| 模块 | 状态 |
|---|---|
| 界面原型（打分 / 标记 / 分批 / 定位）| ✅ |
| `/search` 契约 + 管道（打分 / 去重 / 分批）| ✅ [docs/contract.md](docs/contract.md) |
| Google Places 数据源（评分 / 照片 / 营业时间 / priceRange）| ✅ ADR-008 |
| Edge Function 部署到 Supabase | ✅ |
| 演示版公开链接（GitHub Pages）| ✅ |
| 邮箱 OTP 登录 | 🔨 仅界面 |
| Vite + React 重构、自定义域名 | ⬜ |

## 快速开始

原型是**单个自包含的 HTML 文件**，没有构建步骤、没有依赖：

```bash
git clone https://github.com/<你的用户名>/meshi.git
cd meshi
open prototype/index.html          # macOS
# 或者起个本地服务器（定位功能需要 https 或 localhost）
python3 -m http.server 8000 --directory prototype
```

然后打开 http://localhost:8000 。登录页输入任意 6 位数字，或点「先随便逛逛」。

> 双击打开时店铺 / 评分为演示数据。连真实数据要 `?api=` 指向 Edge Function（见 [docs/deploy.md](docs/deploy.md)）。

```bash
npm run dev    # http://localhost:8787（读 .env，有 Google key 就打真实 API）
npm test
```

## 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 前端 | Vite + React（原型阶段为原生 HTML） | 零审核、随时发布、成本 $1/月 |
| 店铺数据 | Google Places API (New) `searchNearby` | 覆盖全、`priceRange` 真实人均、结构化营业时间、评分 |
| 后端 | Supabase Edge Function | 唯一持有 API Key 的地方，兼做缓存与打分 |
| 数据库 | Supabase Postgres | 只存用户、标记、常用地址；不存店铺数据 |
| 认证 | Supabase Auth（邮箱 OTP） | 免费；短信登录成本过高，延后 |
| 地理编码 | Google Geocoding（同一 key）| 日本门牌号精度最好 |
| 地图 | MapLibre + 免费瓦片 | 之后再加 |
| 部署 | Cloudflare Pages | 免费档足够 |

详细取舍见 [docs/decisions.md](docs/decisions.md)。

## 推荐算法

硬过滤：可达半径、预算区间重叠、口味、营业时间。加权打分见 [docs/contract.md](docs/contract.md)：
`0.35·距离 + 0.25·口味 + 0.25·人气 + 0.05·预算 + 0.10·场景`，权重服务端可调。

## 仓库结构

```
meshi/
├── prototype/index.html      # 交互原型（自包含，无依赖）
├── docs/
│   ├── roadmap.md            # 路线图与里程碑
│   ├── decisions.md          # 架构决策记录（ADR）
│   ├── contract.md          # /search 契约
│   ├── deploy.md            # 部署步骤
│   └── workflow.md           # Git 工作流约定
└── .github/workflows/        # CI：部署原型到 GitHub Pages
```

## 合规

店铺数据来自 Google Places API (New)：页脚显示「Powered by Google」；Place ID 可长期存，
其它内容缓存 ≤30 天，不长期落库；API key 只在 Edge Function。数据源变迁见 [ADR-008](docs/decisions.md)。

## 开发约定

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)，分支与发版流程见 [docs/workflow.md](docs/workflow.md)。

## License

MIT
