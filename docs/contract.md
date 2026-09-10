# `/search` 契约

前端唯一调用的后端接口。数据源是 **Google Places API (New)**（ADR-008）。
类型定义在 [`supabase/functions/_shared/contract.ts`](../supabase/functions/_shared/contract.ts)。

没设 `GOOGLE_PLACES_API_KEY` 时后端回落到演示数据（`_shared/mock/google-places.json`），
契约形状一样，`source` 为 `mock`。

---

## 请求

`POST /search`，body 为 JSON，请求头带 `X-App-Token`（若后端设了 `APP_TOKEN`）：

```jsonc
{
  "origin": { "lat": 35.6912, "lng": 139.7020, "label": "新宿駅 東口" },
  "datetime": "2026-09-11T19:00",   // 本地时间 ISO，无时区
  "transport": "walk",              // walk | bike | train | car
  "maxMinutes": 20,
  "party": 4,                       // 不再硬过滤，仅用于推荐理由 / 场景分
  "genres": ["G001"],               // 前端 genre 码，空数组＝不限。服务端映射到 Google type
  "budgetMin": 2000,                // 円 / 人
  "budgetMax": 5000,
  "exclude": ["ChIJ..."],           // 「只看没吃过的」：要排除的 place id
  "disliked": ["ChIJ..."],          // 用户标了「不喜欢」的 place id
  "batch": 0                        // 分批页码，0 起，每批 5 家
}
```

`origin.lat/lng` 缺失或 `datetime` 无法解析返回 `400`；`X-App-Token` 不匹配返回 `401`。

## 响应

```jsonc
{
  "request": { /* 归一化后的请求回显 */ },
  "reach": { "radiusM": 1600, "formula": "20 × 80 m/min" },
  "total": 12,                      // 通过硬过滤的总数
  "batch": 0, "batches": 3,
  "results": [ /* ShopResult，最多 5 家，已按 score 降序 */ ],
  "rejected": { "distance": 0, "hours": 3, "budget": 1, "genre": 2,
                "excluded": 0, "disliked": 0, "notFood": 1 },
  "attribution": { "text": "Powered by Google", "url": "..." },
  "notes": ["1 家没有营业时间数据，已按不过滤处理并在卡片标注"],
  "source": "google"                // google | mock
}
```

### ShopResult 关键字段

| 字段 | 说明 |
|---|---|
| `genre` | `{ type, label }` —— Google `primaryType`（`ramen_restaurant`）+ 本地化标签（「ラーメン」） |
| `address` | 短地址（区 + 町 + 番地），Google `shortFormattedAddress` 收拾过 |
| `distanceM` / `etaMinutes` | 直线距离 / 按交通方式估算的到达用时 |
| `budget` | `{ lo, hi, level }` 人均区间（円，Google `priceRange`）。**没有价格数据为 `null`** |
| `rating` / `userRatingCount` | Google 评分，搜索结果直接带回（不是单独查的） |
| `reservable` | Google `reservable`，true / false / null |
| `hours` | `{ todayLabel, closeLabel, lastArrivalLabel, openAtTarget, disclaimer }`。结构化，不解析自由文本。`openAtTarget` 为 `"unknown"` 时 UI 标注「营业时间以店家为准」 |
| `photo` | `{ url }` —— 已解析的 Google 照片 CDN URL，**只对返回的这一批解析**（控制 Photo Media 调用）；`photoName` 供抽屉懒解析 |
| `url` | Google Maps 店铺页 |
| `popularity` / `score` / `scoreBreakdown` | 人气分（有评分用评分算）/ 最终分 / 各项加权前原始值 |
| `why` | 推荐理由碎片，前端用「·」拼接 |

---

## 打分

硬过滤：可达半径 → 预算区间重叠（含 10% 容差）→ 口味（Google type / types 完全不沾才挡）
→ 营业时间（`regularOpeningHours`，打烊前留 45 分钟余量）。无营业时间数据时**不过滤**，`disclaimer=true`。

加权（权重在 [`score.ts`](../supabase/functions/_shared/score.ts) `SCORE_WEIGHTS`，改了不用发版）：

```
score = 0.35·距离 + 0.25·口味 + 0.25·人气 + 0.05·预算 + 0.10·场景
```

- 人气 = `ratingToPopularity(rating, count)`（3.0 星→0，4.5 星→满；评论数对数拉平）
- 预算 = 区间覆盖率（`budgetCoverage`），权重低，只当微弱加分项
- 场景 = `reservable`（≥4 人时）+ 高评分 + 评论数多 的小加分

候选池：Google `searchNearby` 每次返回 ≤20，无翻页。半径 ≤2km 一次（DISTANCE 排序）；
更大时再补一次 POPULARITY 排序，按 place id 合并。去重见 [`dedupe.ts`](../supabase/functions/_shared/dedupe.ts)。

---

## 本地开发

```bash
npm run dev          # http://localhost:8787，无需 Deno / Supabase CLI
npm test             # 单元测试

open "http://localhost:8787/?api=http://localhost:8787&token=<APP_TOKEN>"   # 原型连本地后端
open "http://localhost:8787/?api=off"                                      # 切回自包含演示数据
```

`?api=` / `?token=` 首次打开写进 localStorage，`token` 会立刻从地址栏擦掉。

部署见 [deploy.md](deploy.md)。
