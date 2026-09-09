# `/search` 契约

前端唯一调用的后端接口。本地演示数据和真实 HotPepper 走**同一条管道**产出**同一形状**，
类型定义在 [`supabase/functions/_shared/contract.ts`](../supabase/functions/_shared/contract.ts)。

当前阶段：管道骨架已就绪，未接入真实 API。设 `HOTPEPPER_API_KEY` 环境变量即切真实数据，不改代码。

---

## 请求

`POST /search`，body 为 JSON：

```jsonc
{
  "origin": { "lat": 35.6912, "lng": 139.7020, "label": "新宿駅 東口" },
  "datetime": "2026-09-11T19:00",   // 本地时间 ISO，无时区
  "transport": "walk",              // walk | bike | train | car
  "maxMinutes": 20,
  "party": 4,
  "genres": ["G001"],               // HotPepper genre code，空数组＝不限
  "budgetMin": 2000,                // 円 / 人
  "budgetMax": 5000,
  "exclude": ["J00xxxx"],           // 「只看没吃过的」：要排除的 shop id
  "disliked": ["J00yyyy"],          // 用户标了「不喜欢」的 shop id
  "batch": 0                        // 分批页码，0 起，每批 5 家
}
```

服务端对所有数值字段做范围钳制；`origin.lat/lng` 缺失或 `datetime` 无法解析返回 `400`。

## 响应

```jsonc
{
  "request": { /* 归一化后的请求回显，datetime 变成带时区 ISO */ },
  "reach": { "radiusM": 1600, "formula": "20 × 80 m/min" },
  "total": 8,                       // 通过硬过滤的总数
  "batch": 0,
  "batches": 2,
  "results": [ /* ShopResult，最多 5 家，已按 score 降序 */ ],
  "rejected": { "distance": 3, "hours": 1, "capacity": 2, "budget": 2,
                "genre": 0, "excluded": 0, "disliked": 0 },
  "attribution": { "text": "Powered by ホットペッパーグルメ", "url": "..." },
  "notes": ["3 家营业时间无法确定，已按不过滤处理并在卡片标注"],
  "source": "mock"                  // mock | hotpepper
}
```

### ShopResult 关键字段

| 字段 | 说明 |
|---|---|
| `distanceM` / `etaMinutes` | 直线距离 / 按交通方式估算的到达用时 |
| `budget.mid` | 从 `budget.name` 区间解析的中位数，打分用；`budget.average` 仅展示 |
| `hours.todayLabel` | 目标那天的营业时段，如 `"17:00–翌00:00"`；解析不出为 `null` |
| `hours.lastOrderMin` / `lastOrderLabel` | 目标那天的料理 L.O. |
| `hours.openAtTarget` | `true` / `false` / `"unknown"`（未能判断，已降级为不过滤） |
| `hours.disclaimer` | `true` 时 UI 显示「营业时间以店家为准」 |
| `popularity` | **合成人气分 0..1**。ADR-004 未决，HotPepper 不返回 rating/reviews。**不是评分。** |
| `score` / `scoreBreakdown` | 最终分 与 各项加权前原始值（distance/genre/popularity/budget/scene） |
| `why` | 推荐理由碎片，前端用「·」拼接 |
| `url` | `urls.pc`，含 `vos=` 追踪参数，**原样透传，不得改写**（Recruit 条款） |

---

## 打分

硬过滤：定休日 → 可达半径 → 人数 → 预算区间重叠 → 口味 → 营业时间（含 L.O. 提前
`LO_MARGIN_MIN`＝60 分钟余量）。营业时间解析失败或目标日无排班时**不过滤**，`hours.disclaimer=true`。

加权（权重在 [`score.ts`](../supabase/functions/_shared/score.ts) `SCORE_WEIGHTS`，改了不用发版）：

```
score = 0.30·距离 + 0.25·口味 + 0.20·人气 + 0.15·预算 + 0.10·场景
```

多中心点采样（半径 > 3km）见 [ADR-003](decisions.md#adr-003)，实现在 [`reach.ts`](../supabase/functions/_shared/reach.ts) `samplingCenters`。

---

## 本地开发

```bash
npm run dev          # http://localhost:8787，无需 Deno / Supabase CLI
npm test             # 解析器 + 打分 + 管道的单元测试

# 原型连本地后端：
open "http://localhost:8787/?api=http://localhost:8787"
# 关掉、回到自包含演示数据：
open "http://localhost:8787/?api=off"
```

`?api=` 会记进 localStorage；不带参数、且没设过的话，原型用内置演示数据（可直接双击打开）。

## 部署（key 到位后）

```bash
supabase functions deploy search
supabase secrets set HOTPEPPER_API_KEY=xxxx
```

`supabase/functions/search/index.ts` 只是 HTTP 壳，逻辑全在 `_shared/`。
未设 key 时线上也会回落到演示数据。
