# 路线图

## 里程碑

### M0 — 界面评审 ✅ 进行中

把交互和信息架构定下来，不碰后端。

- [x] 条件表单：地址、时间、交通方式、时长、人数、口味、预算
- [x] 打分引擎（前端演示实现）与推荐理由文案
- [x] 结果卡片：照片、店名、位置、类型、人均、评分、评论数、支付方式
- [x] 标记：吃过 / 喜欢 / 不喜欢，带撤销
- [x] 「就这家」选定与取消，高亮状态
- [x] 每批 5 家 + 换一批；排除吃过的 / 只看喜欢的
- [x] 出发地门牌号输入 + 联想 + 常用地址 + 当前位置定位
- [x] 卡片跳转到 HotPepper 店铺页
- [ ] 移动端布局复核（真机）
- [ ] 「就这家 → 吃过 → 评价」的闭环交互定稿

### M1 — 数据管道

- [ ] 申请 HotPepper API Key ← **关键路径，有审核等待，尽早做**
- [x] 拉取 genre / budget 主数据码表 —— `_shared/master.ts`：从 master API 拉 + 缓存 24h，失败回落快照；`GET /masters`
- [x] 抽真实 `open` 字段分析格式 —— `npm run sample:open` 跑了 184 条，解析器 status 全 ok；结论见 `docs/api-response.md`
- [x] 营业时间解析器 + 单元测试 —— `_shared/openHours.ts`，含 `open` / `close` 两个解析器，37 条测试
- [x] `/search` 管道骨架：可达半径、硬过滤、加权打分、多中心点采样 + 去重、分批 —— `_shared/pipeline.ts`
- [x] `/search` 契约 + 前端接入 —— 见 `docs/contract.md`；原型 `?api=` 切后端，默认仍是自包含演示数据
- [x] 本地开发服务器 —— `npm run dev`（Node，无需 Deno / Supabase CLI）
- [x] 接真实 HotPepper：`npm run check:api` 跑通，字段假设已校准（`non_smoking` 多出 `未確認`、
      budget 码表细分成 17 档、`mobile_access` 有时是广告文案）。原型 `?api=` 已能看真实数据
- [ ] **Google Cloud 配额熔断**（ADR-004/007）← 启用 Google API 当天必做：Places 200/天、Geocoding 500/天上限
- [ ] 接 Google Places 取 `rating` / `userRatingCount`（服务端 + 24h 缓存 + 当日调用硬上限），替换合成人气分展示
- [ ] 接 Google Geocoding：出发地自由文本 → 经纬度，替换固定演示地址库
- [ ] 打分调优：从繁忙车站搜时 distance / budget / 人气 分都容易顶格，前 5 名区分度低（等 Google 评分接进来一起调，权重服务端可调）
- [ ] Supabase 项目初始化
- [ ] Edge Function 部署（`supabase/functions/search/index.ts` HTTP 壳已写）+ 24h 缓存
- [ ] 前端把演示数据整段换成真实数据（真实照片 `photo.pc.l`、真实营业信息）—— 抽屉已接，卡片缩略图待接

### M2 — 账号与持久化

- [ ] Supabase Auth 邮箱 OTP
- [ ] 匿名会话（游客模式）与登录后合并本地数据
- [ ] 标记、常用地址、选定记录落库
- [ ] 评分来源决策落地（见 ADR-004）

### M3 — 上线

- [ ] Vite + React 重构（原型现为原生 HTML）
- [ ] 空结果 / 网络错误 / 定位拒绝的兜底
- [ ] HotPepper 署名与 logo
- [ ] 隐私政策
- [ ] Cloudflare Pages 部署 + 自定义域名
- [ ] 找 5–10 个在东京的人试用

### 之后

- Google Places 补长尾与评分
- 地图视图
- 多人投票选店
- iOS 壳（算法稳定后）

---

## 当前待办

按优先级，从上往下做。

| 优先级 | 事项 | 阻塞 |
|---|---|---|
| 🔴 now | Google Cloud Console 设配额熔断（Places 200/天、Geocoding 500/天） | 需先建 GCP 项目 |
| 🔴 now | Google key 填进 `.env` 的 `GOOGLE_PLACES_API_KEY` | 上一条 |
| 🟡 next | 接 Google Places 评分 + Geocoding（服务端 + 缓存 + 当日硬上限） | Google key |
| 🟡 next | 打分调优（繁忙车站前 5 名区分度低） | Google 评分接进来 |
| 🟡 next | 「就这家 → 评价」闭环交互定稿 | 需产品决策 |
| 🟡 next | 移动端真机复核 | — |
| 🟢 later | Supabase 项目 + Edge Function 部署 + 24h 缓存 | — |
| 🟢 later | Vite + React 重构 | 界面定稿 |

✅ 已完成：申请 HotPepper Key、确认评分来源（ADR-004→Google Places）、`open` 字段抽样分析、
真实 key 跑通 `/search`、地理编码选型（ADR-007→Google Geocoding）。

---

## 待决策问题

**1. 评分从哪来？** ✅ 已定：Google Places（ADR-004）。前提是先设 Google 配额熔断。

**2.「就这家」和「吃过」怎么联动？** 现在两者独立。可能的闭环：点了「就这家」→ 到了就餐时间之后 → 提示「今晚去了 XX 吗？」→ 自动标记「吃过」并请求打分（喜欢 / 不喜欢）。这样标记数据能自然积累，不需要用户主动想起来。需要确认是否要做时间触发的提示。

**3. 照片。** ✅ 已定：正式版用真实照片（HotPepper `photo.pc.l`）。无照片的店保留矢量插画作兜底（风格和整体视觉搭）。**注意**：HotPepper 最大图只有 238px 宽，详情页做不了大图 hero（见 api-response.md 坑 #2）。
