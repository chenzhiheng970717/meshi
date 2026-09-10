# 路线图

## 里程碑

### M0 — 界面评审 ✅ 基本完成

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

**已搭好的通用管道**（数据源无关）：

- [x] `/search` 契约 + 前端接入 —— `docs/contract.md`；原型 `?api=` 切后端，默认自包含演示
- [x] 可达半径换算、加权打分、分批、`X-App-Token` 鉴权 —— `_shared/{reach,score,pipeline}.ts`
- [x] 本地开发服务器 `npm run dev`；47 条单元测试
- [x] Edge Function 部署到 Supabase（`search`，region 东京），secret 管理
- [x] 前端演示版 → GitHub Pages；真实数据版 `?api=` + `?token=`
- [x] Google Places 评分 + Geocoding（正向 / 反向）—— `_shared/google.ts`，双熔断
- [x] 真实照片、Google 评分展示、定位显示地址

**HotPepper 阶段**（ADR-008 后弃用，代码保留在 git 历史）：

- [x] ~~接 HotPepper グルメサーチ + master API + 营业时间自由文本解析器~~ —— 都做过、跑通过；
      因住宅区覆盖太薄改用 Google，见 ADR-008

**转 Google Places（ADR-008）—— 当前工作**：

- [ ] Google Cloud 配额调整：SearchNearby/SearchText 100–300/天、GetPhotoMedia 300/天、
      Geocoding 300/天，其余压到 1
- [ ] `_shared/places.ts`：Text/Nearby Search 客户端，翻页凑 ~60 候选，字段掩码取
      `priceRange` / `rating` / `regularOpeningHours` / `primaryType` / `photos`
- [ ] genre → Google `primaryType` / `includedType` 映射表
- [ ] `regularOpeningHours` → 现有营业判断逻辑（结构化，删 `openHours.ts` 自由文本解析）
- [ ] `priceRange` → 预算区间重叠过滤
- [ ] 人数降级为软提示；包间标签换成 `reservable`「可预约」
- [ ] Google 照片：`photos[].name` → Photo Media 端点（服务端代理 or 缓存）
- [ ] 页脚「Powered by Google」；去掉 HotPepper 署名
- [ ] 打分调优：距离 / 预算项在繁忙车站搜索时易顶格，调分数曲线

### M2 — 账号与持久化

- [ ] Supabase Auth 邮箱 OTP
- [ ] 匿名会话（游客模式）与登录后合并本地数据
- [ ] 标记、常用地址、选定记录落库
- [ ] 持久化缓存（Deno KV / Supabase 表，≤30 天）—— 省 Google 配额，替代现在的进程内缓存
- [ ] 自建「喜欢」比例开始作为人气信号（ADR-004）

### M3 — 上线

- [ ] Vite + React 重构（原型现为原生 HTML）
- [ ] 空结果 / 网络错误 / 定位拒绝的兜底
- [ ] 页脚「Powered by Google」
- [ ] 隐私政策
- [ ] Cloudflare Pages 部署 + 自定义域名（正式版前端，构建期注入 api / token）
- [ ] 找 5–10 个在东京的人试用

### 之后

- 地图视图（MapLibre）
- 多人投票选店
- iOS 壳（算法稳定后）

---

## 当前待办

按优先级，从上往下做。

| 优先级 | 事项 | 阻塞 |
|---|---|---|
| 🔴 now | Google Cloud 配额调整（SearchNearby/Text 100–300、Photo 300、Geocoding 300，其余→1） | — |
| 🔴 now | 数据层换 Google Places（`_shared/places.ts` + genre 映射 + priceRange 过滤 + 营业时间） | ADR-008 已定 |
| 🟡 next | Google 照片接入（Photo Media 端点，服务端代理 / 缓存） | 上一条 |
| 🟡 next | 打分调优（繁忙车站前 5 名区分度低，调分数曲线） | — |
| 🟡 next | 「就这家 → 评价」闭环交互定稿 | 需产品决策 |
| 🟡 next | 人数输入去留（软提示 or 直接删）| 需产品决策 |
| 🟡 next | 移动端真机复核 | — |
| 🟢 later | 持久化缓存（省配额）；Vite + React 重构；Cloudflare Pages 正式前端 | — |

✅ 已完成：`/search` 管道 + 契约、Supabase 部署、GitHub Pages 演示版、Google 评分 + Geocoding、
真实照片、定位显示地址。HotPepper 全链路做过又因覆盖问题弃用（ADR-008）。

---

## 待决策问题

**1. 评分从哪来？** ✅ 已定：Google Places（ADR-004 / ADR-008 —— Google 现在就是数据源本身）。

**2.「就这家」和「吃过」怎么联动？** 现在两者独立。可能的闭环：点了「就这家」→ 到了就餐时间之后 → 提示「今晚去了 XX 吗？」→ 自动标记「吃过」并请求打分（喜欢 / 不喜欢）。需要确认是否要做时间触发的提示。

**3. 照片。** ✅ 已定：真实照片（Google `photos`），无照片的店保留矢量插画兜底。Google 照片走 Photo Media 端点，`maxWidthPx` 可以要到 1600，详情页大图可行（比 HotPepper 238px 强）。

**4. 人数输入。** Google 无 `party_capacity`（ADR-008）。当前：降级为软提示。待定是否直接从表单删掉「人数」。
