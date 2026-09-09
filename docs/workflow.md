# Git 工作流约定

一个人开发也值得有规矩——不是为了流程本身，是为了三个月后你还能看懂当时在想什么，以及出问题时能干净地回退。

## 分支模型

只用两类分支，不要 GitFlow 那一套，单人开发用不上。

```
main                    # 永远可运行。每次合并都是一个可发布状态
└── feat/hotpepper-api  # 功能分支，做完就合并并删除
└── fix/empty-state     # 修复分支
```

**规则：**

- `main` 不直接提交，哪怕是一个人。走分支 + PR，是为了让每次改动都有一个可以回头看的说明页。
- 分支命名 `<类型>/<简短描述>`，用连字符，全小写。
- 分支活不过三天。超过三天说明拆得太大了。

## 提交信息

用 [Conventional Commits](https://www.conventionalcommits.org/)。格式：

```
<类型>(<范围>): <一句话，祈使句，不加句号>

<可选的正文：为什么这么改，不是改了什么>

<可选的脚注：Closes #12>
```

**类型：**

| 类型 | 用于 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修 bug |
| `docs` | 只改文档 |
| `style` | 格式、空格、分号，不影响逻辑 |
| `refactor` | 重构，不改行为也不修 bug |
| `perf` | 性能优化 |
| `test` | 加测试或改测试 |
| `chore` | 构建、依赖、CI 配置 |

**范围**用模块名：`ui`、`score`、`api`、`auth`、`geo`、`data`。

**例子：**

```
feat(ui): 出发地支持门牌号输入与当前位置定位

原来只能选四个车站预设，无法表达「我在家」这种常见场景。
改成自由输入 + 联想匹配，并加了 geolocation 定位按钮。
演示数据只覆盖东京，定位超出 60km 时贴到最近的演示区域。
```

```
fix(score): 修正预算贴合度在预算区间为零跨度时除零
```

**不要写的提交信息：** `update`、`fix bug`、`修改`、`wip`。半年后这些等于没写。

## 版本与标签

用 [语义化版本](https://semver.org/lang/zh-CN/)。原型阶段停在 `0.x`：

- `0.1.0` 首个可点击原型
- `0.2.0` 视觉重做 + 标记与分批
- `0.3.0` 门牌号地址、定位、外链跳转

打标签：

```bash
git tag -a v0.3.0 -m "原型 v0.3：门牌号地址、定位、外链跳转"
git push origin v0.3.0
```

接上 HotPepper API 并能跑通端到端时发 `1.0.0`。

## 回退

这是搞规范提交最实际的回报。

```bash
# 看历史（一行一个）
git log --oneline --graph --decorate -20

# 回到某个提交去看看（不改动 main）
git checkout v0.2.0
git switch -                    # 回到原来的分支

# 已推送的提交要撤销：用 revert，生成一个反向提交，历史不撕裂
git revert <commit>

# 未推送的本地提交要丢掉
git reset --hard HEAD~1         # 危险：改动会丢

# 只想找回某个文件的旧版本
git checkout v0.2.0 -- prototype/index.html
```

## 每次改动的完整流程

```bash
git switch main && git pull
git switch -c feat/hotpepper-api

# ...改代码...

git add -p                      # 分块暂存，顺便复查自己改了什么
git commit -m "feat(api): 接入 HotPepper グルメサーチAPI"
git push -u origin feat/hotpepper-api

gh pr create --fill             # 或在网页上开 PR
gh pr merge --squash --delete-branch
```

**`git add -p` 是个好习惯**——它逼你在提交前把自己的改动再看一遍，能拦下大量「顺手改的调试代码」。

## Issue 与看板

用 GitHub Issues 记待办，标签建议：

- `type: feat` / `type: bug` / `type: chore`
- `area: ui` / `area: api` / `area: score` / `area: infra`
- `prio: now` / `prio: next` / `prio: later`

不需要一开始就建 Project 看板。Issue 列表加标签筛选，单人开发足够了。

## 不要提交进仓库的东西

已经写在 `.gitignore` 里，但值得单独强调：

- **API Key、`.env`、任何凭据。** HotPepper Key 一旦进了 git 历史，删掉文件也没用——历史里还在。真泄漏了就去 Recruit 后台重新生成。
- `node_modules/`、构建产物 `dist/`
- `.DS_Store` 和编辑器配置

提交前想不确定，就跑 `git status` 看一眼。
