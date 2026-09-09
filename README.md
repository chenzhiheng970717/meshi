<div align="center">

# MESHI 🍜

**东京餐厅推荐 — 按时间、位置、预算和口味，挑出真正合适的五家**

[![Prototype](https://img.shields.io/badge/prototype-v0.3-C0431D)](prototype/index.html)
[![Stage](https://img.shields.io/badge/stage-UI%20review-9C6D18)](docs/roadmap.md)
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

**UI 评审阶段。** 交互原型已完成并可操作，后端尚未接入。

| 模块 | 状态 |
|---|---|
| 界面原型（含打分引擎、标记、分批） | ✅ v0.3 |
| 邮箱 OTP 登录 | 🔨 仅界面 |
| HotPepper API 接入 | ⬜ 未开始 |
| Supabase Edge Function 代理 | ⬜ 未开始 |
| 部署 | ⬜ 未开始 |

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

> 原型内的店铺、评分、评论数**全部是演示数据**，不是真实营业信息。

## 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 前端 | Vite + React（原型阶段为原生 HTML） | 零审核、随时发布、成本 $1/月 |
| 店铺数据 | [HotPepper グルメサーチAPI](https://webservice.recruit.co.jp/doc/hotpepper/reference.html) | 免费，且原生支持预算 / 人数 / 包间筛选 |
| 后端 | Supabase Edge Function | 唯一持有 API Key 的地方，兼做缓存与打分 |
| 数据库 | Supabase Postgres | 只存用户、标记、常用地址；不存店铺数据 |
| 认证 | Supabase Auth（邮箱 OTP） | 免费；短信登录成本过高，延后 |
| 地图 | MapLibre + 免费瓦片 | 避免 Google Maps 计费 |
| 部署 | Cloudflare Pages | 免费档足够 |

详细取舍见 [docs/decisions.md](docs/decisions.md)。

## 推荐算法

**硬过滤**（不满足直接淘汰）：营业时间、可达半径、预算区间重叠、容纳人数、口味分类。

**加权打分**：

```
score = 0.30·距离 + 0.25·口味 + 0.20·人气 + 0.15·预算 + 0.10·场景
```

交通方式转换成可达半径：

| 方式 | 公式 |
|---|---|
| 步行 | `R = T × 80 m/min` |
| 自行车 | `R = T × 250 m/min` |
| 电车 | `R = max(0, T − 12) × 400 m/min` |
| 驾车 | `R = max(0, T − 10) × 300 m/min` |

电车扣掉的 12 分钟是步行接驳和候车，驾车扣掉的 10 分钟是市区找车位。这两个常数应该做成服务端可调参数。

## 仓库结构

```
meshi/
├── prototype/index.html      # 交互原型（自包含，无依赖）
├── docs/
│   ├── roadmap.md            # 路线图与里程碑
│   ├── decisions.md          # 架构决策记录（ADR）
│   ├── data-sources.md       # 数据源对比与合规要求
│   └── workflow.md           # Git 工作流约定
└── .github/workflows/        # CI：部署原型到 GitHub Pages
```

## 合规

店铺数据来自 Recruit 的 HotPepper API，使用时必须遵守其[利用规约](https://cdn.p.recruit.co.jp/terms/rws-t-1001/index.html)：

- 必须显示数据来源署名与 logo
- 缓存不得超过 24 小时，不得永久复制入库
- 商用变现需事先取得书面同意

详见 [docs/data-sources.md](docs/data-sources.md)。

## 开发约定

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)，分支与发版流程见 [docs/workflow.md](docs/workflow.md)。

## License

MIT
