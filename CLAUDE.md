# CLAUDE.md

东京餐厅推荐应用。用户输入出发地、就餐时间、交通方式、可接受路程时长、人数、口味、人均预算，返回排好序的五家店并说明推荐理由。

**当前阶段：M0 界面评审。** 交互原型已完成，后端未接入。全部店铺数据是演示数据。

开工前先读 `docs/roadmap.md`（当前待办与待决策）和 `docs/decisions.md`（已定的架构决策，不要重新讨论）。

---

## 硬约束

违反这些会导致真实损失，优先级高于任何其他考虑。

**API Key 绝不进客户端、绝不进仓库。** HotPepper Key 只存在于 Supabase Edge Function 的环境变量里。前端只调自己的 `/search`。Key 一旦进了 git 历史，删文件也没用——历史里还在，只能去 Recruit 后台重新生成。

**HotPepper 数据不得落库。** Recruit 条款要求：缓存 ≤ 24 小时，不得复制进第三方数据库。Postgres 只存用户、标记、常用地址。页脚必须显示「Powered by ホットペッパーグルメ」署名与官方 logo，不可移除。商用变现需事先书面同意。

**Google Places 要先设配额熔断。** 若启用，当天就在 Cloud Console 设每日请求数上限（Quotas，建议 200/天）。预算告警只发邮件不阻断计费。`rating` / `priceLevel` / `regularOpeningHours` 都是 Enterprise 字段，每月仅 1000 次免费，超出 $35/千次——一个 `useEffect` 依赖写错就能烧掉四位数美元。

**游客必须能直接搜索。** 核心功能不得强制登录。这既是产品判断，也是将来做 iOS 时 App Store 条款 5.1.1(v) 的硬要求。

---

## 已定的技术选型

不要重新提议替代方案，理由都在 `docs/decisions.md`。

| 层 | 选择 |
|---|---|
| 平台 | 网页优先，iOS 壳等算法稳定后再加。微信小程序已排除 |
| 前端 | Vite + React（原型阶段是原生 HTML 单文件） |
| 店铺数据 | HotPepper グルメサーチAPI（免费，原生支持预算/人数/包间） |
| 后端 | Supabase Edge Function（持 Key + 缓存 + 打分） |
| 数据库 | Supabase Postgres |
| 认证 | Supabase Auth 邮箱 OTP + 匿名会话。**不做短信登录** |
| 地图 | MapLibre + 免费瓦片 |
| 部署 | Cloudflare Pages |

---

## 推荐算法

打分逻辑放服务端，改权重不用发版。

**硬过滤**：营业时间（含 L.O. 提前 1 小时余量）、可达半径、预算区间重叠、`party_capacity` ≥ 人数、口味分类命中。

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

**HotPepper `range` 上限 3km。** 目标半径更大时按 8 个方位角多中心点采样，按 `shop.id` 去重合并。

**`open` 字段是自由文本**，形如「月～金 17:00～23:30（L.O.23:00）、土日祝 16:00～24:00」。写解析器之前先抽 100 条真实数据人工看格式，别凭想象写正则。解析失败时降级为不过滤 + UI 标注「营业时间请以店家为准」。

**genre / budget 码表动态拉取**，通过对应的 master API，不要硬编码。

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
- 版本标签遵循语义化版本，原型阶段停在 `0.x`。接通 HotPepper 并跑通端到端时发 `1.0.0`。

---

## 三个待决策问题 —— 不要擅自决定

需要产品方拍板，遇到时问，别自己选一个然后往下写。

1. **评分数据来源。** HotPepper 不返回 `rating` / `reviews`。选项：接 Google Places（Enterprise 字段，单人使用免费额度够）/ 只显示自建的「喜欢」比例 / 不显示评分改显示合成人气分。详见 ADR-004。
2. **「就这家 → 吃过 → 评价」的闭环。** 现在两个标记独立。可能做成时间触发：就餐时间过后提示「今晚去了 XX 吗？」，自动标记吃过并请求打分。是否要做时间触发提示未定。
3. **矢量插画是否保留**作为无照片店铺的兜底。正式版照片用 `photo.pc.l`。

---

## 常用命令

```bash
# 本地打开原型（定位功能需要 localhost 或 https）
python3 -m http.server 8000 --directory prototype

# 看历史
git log --oneline --graph --decorate -20

# 回退
git revert <commit>                        # 已推送的，生成反向提交
git checkout v0.2.0 -- prototype/index.html # 只找回某个文件的旧版本
```
