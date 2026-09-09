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
- [x] 拉取 genre / budget 主数据码表 —— `_shared/master.ts`：有 key 从 master API 拉 + 缓存 24h，失败回落快照；`GET /masters`
- [~] 抽 100 条真实 `open` 字段人工分析格式 —— `npm run sample:open`（脚本就绪，等 key 跑）；解析器现按 `docs/api-response.md` 样本写
- [x] 营业时间解析器 + 单元测试 —— `_shared/openHours.ts`，含 `open` / `close` 两个解析器，37 条测试
- [x] `/search` 管道骨架：可达半径、硬过滤、加权打分、多中心点采样 + 去重、分批 —— `_shared/pipeline.ts`
- [x] `/search` 契约 + 前端接入 —— 见 `docs/contract.md`；原型 `?api=` 切后端，默认仍是自包含演示数据
- [x] 本地开发服务器 —— `npm run dev`（Node，无需 Deno / Supabase CLI）
- [~] 接真实 HotPepper：客户端已写（多中心点并发翻页、按 id 去重、party_capacity 谨慎收窄、错误容忍），
      等 `npm run check:api` 用真实响应校准字段假设
- [ ] `npm run sample:open` 跑一批，人工看格式，回填 `openHours.ts` 的正则直到覆盖率 ≥ 85%
- [ ] Supabase 项目初始化
- [ ] Edge Function 部署（`supabase/functions/search/index.ts` HTTP 壳已写）+ 24h 缓存
- [ ] 前端把演示数据整段换成真实数据（真实照片 `photo.pc.l`、真实营业信息）
- [ ] 地理编码：出发地自由文本 → 经纬度（原型现为固定演示地址库；选 geocoder 是另一个决策）

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
| 🔴 now | 申请 HotPepper API Key | — |
| 🔴 now | 确认评分数据来源（ADR-004） | 需产品决策 |
| 🟡 next | 抽样分析 `open` 字段格式，回填 `openHours.ts` fixture | API Key |
| 🟡 next | 用真实 key 跑 `/search`，验证候选池 / 字段 / 广告位翻页 | API Key |
| 🟡 next | 「就这家 → 评价」闭环交互定稿 | 需产品决策 |
| 🟡 next | 移动端真机复核 | — |
| 🟢 later | Supabase 项目 + Edge Function 部署 + 24h 缓存 | API Key |
| 🟢 later | Vite + React 重构 | 界面定稿 |

---

## 待决策问题

**1. 评分从哪来？** HotPepper 不返回。三个选项见 [ADR-004](decisions.md#adr-004)。

**2.「就这家」和「吃过」怎么联动？** 现在两者独立。可能的闭环：点了「就这家」→ 到了就餐时间之后 → 提示「今晚去了 XX 吗？」→ 自动标记「吃过」并请求打分（喜欢 / 不喜欢）。这样标记数据能自然积累，不需要用户主动想起来。需要确认是否要做时间触发的提示。

**3. 照片。** 原型用的是按分类画的矢量插画（明确标了「示例图」）。正式版用 HotPepper 返回的 `photo.pc.l`。但插画风格和整体视觉挺搭——是否在无照片的店上保留插画作为兜底？
