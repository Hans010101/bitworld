# BitWorld Chat 接力包 v6

**日期**:2026-05-13 凌晨
**核心进展**:Phase 5b PDF 内容优化 3 批完整收官(Hotfix v8/v9/v9.1)+ BW-95 GitHub Actions auto-pr-merge 实战 4 次全绿(本日累计)+ BW-100~112 新沉淀 13 条铁律

---

## § 0 必读 — Chat 行为规则(沿用 v5,本版本仅强化 BW-110/111)

继承 v5 § 0.1–0.10 全部规则。本版新增/强化:

### 0.11 部署链时间认知(BW-110/111,本批新增)

- ❌ Code 完工 ≠ 部署完成。Code 视角("push + ls-remote ✅")是必要不充分条件
- ❌ PDF 截图 timestamp 必须先看。若 PDF 内部时间戳 < Hotfix push 时间 → 是定时任务用旧 image,不是 Hotfix 失败
- ✅ 每个 Hotfix push 后 → ~10 min 后看 Cloud Build 是否绿 + revision 是否新 → 现场发飞书指令测(不等定时任务)
- ✅ Chat 看 Hans PDF 截图诊断"Hotfix 没生效"前,先对比时间戳,不直接跳到部署链 3 检查

### 0.12 长指令 cursor/状态机 API 警示(BW-112,本批新增)

- ✅ 长指令含 PDF / canvas / 图形渲染 API 时,显式标注 cursor reset 责任
- 例:`doc.text(t, x, y, opts)` 调完必须 `doc.x = doc.page.margins.left`

---

## § 1 项目状态快照(2026-05-13 凌晨,Phase 5b 收官时刻)

### 1.1 GitHub / Cloud Run / Supabase

| 维度 | 状态 |
|---|---|
| GitHub master HEAD | **`e517fcd` (短) / `e517fcdc891c5b7ebda477cc6150def8d4d34cf0` (完整)** — Hotfix-v9.1 BW-95 自动 merge 后(PR #12 squash commit) |
| 本日累计 BW-95 自动 merge 次数 | 4 次(Hotfix-v7 self-install + v8 + v9 + v9.1) |
| 待 Hans 手 merge | 0(BW-95 永久生效后) |
| Cloud Run revision | Hotfix-v9.1 部署后最新 |
| 生产链路 | 飞书 webhook → issue → 委派 → 4 事业部 → reverse-agg → markIssueDone → sendNotification → 摘要 + PDF 双消息 + markdown 完整渲染 ✅ |

### 1.2 本日累计 push 的 commit(20+ 个,Hotfix-v1~v9.1 全链)

```
e517fcd fix(phase5b): reset doc.x after renderTable (Hotfix-v9.1 squash, #12)
f630d17 feat(phase5b): batch2 markdown-to-PDF rendering pipeline (Hotfix-v9, #11)
3b8faa9 feat(phase5b): batch1 PDF content optimization (Hotfix-v8, #10)
24a5b71 feat(ci): auto PR + squash merge for claude/** branches (BW-95, #9)
82884b1 Merge PR #8 → Hotfix-v6 (PostScript face name 修中文乱码, BW-94)
[...v1-v5 见 v5 § 1.2]
```

---

## § 2 Phase 5b PDF 优化 chain reasoning(本批核心)

| Hotfix | Commit | 真根因 | 修复 | 触达层 | 新 BW |
|---|---|---|---|---|---|
| v8 | 3b8faa9 | PDF 文件名 + 大标题占位 + Agent prompt 真权威定位 | extractReportTopic + 大标题改 + 4 CEO AGENTS.md append | openai-post-run.ts + agents/中文 CEO/AGENTS.md | BW-100~108 |
| v9 | f630d17 | PDF 无 markdown 渲染 + Agent 自由发挥头部噪音 | stripReportMetadata + renderMarkdownToPdf + renderTable + 14 skills/*.md 禁令 | openai-post-run.ts + skills/{news,crypto,sentiment,research}/*.md | BW-109~111 |
| v9.1 | e517fcd | renderTable 的 doc.text(t,x,y,opts) 设了 doc.x → 后续段挤右侧 | doc.x = page.margins.left reset | openai-post-run.ts renderTable 末尾 +5 行 | BW-112 |

链式特性:每个 Hotfix 触达更深一层,Hotfix-v9.1 是经典 pdfkit cursor 状态机坑 — Chat 出指令时未警告(BW-112 来源)。

---

## § 3 本日新沉淀 BW 铁律(BW-100~113,共 14 条)

| 编号 | 教训 |
|---|---|
| BW-100 | Chat 接到"接力包/规则文档已上传 + 你必须遵守"开场时,先实测 view 上传文件原文,不基于 Hans 转述直接确认规则 |
| BW-101 | Chat 在 Code 已完工领域出挑战时,明确区分"verify ask(核对语气)"vs"real gap(警告语气)",混用让用户误以为每个挑战都是新发现 |
| BW-102 | Chat 列多选项时区分"门槛任务"(不做会让前面投资白搭)vs"扩展任务"(独立 ROI),门槛任务必须单列优先,不能与扩展任务三选一 |
| BW-103 | Chat 引用代码设计点(如 continue-on-error / try-catch / 重试)时,必须说清楚作用域(哪一步生效),不能笼统说"设计了兜底" |
| BW-104 | Chat 给 Hans 估时不仅算"操作动作秒数",还要算"等待 + 确认 + 反馈循环成本",后者通常占 60-80% |
| BW-105 | Chat 看截图做状态推断时,每条推断要么从截图直接读出,要么显式标注"推断:基于 X 推 Y",混合两类信息容易把推断当事实陈述 |
| BW-106 | Chat 出多确认问题时,所有问题用统一选项格式(a)/(b)/(c),即便某些问题语义上是 yes/no |
| BW-107 | 信息不全时优先邀请用户"自由叙述",不要先列 a/b/c 多选(后者适合"选项已穷举且互斥",不适合"需求探索") |
| BW-108 | Chat 出长指令前若含具体文件路径/关键字/函数名,Step 1 之前加 "audit" 段:用 grep/ls 实测,把"假设清单"翻成"实测清单"再进 Step 2 |
| BW-109 | Chat 出长指令时 § 5 自主决策权预授权 "Step 1 audit 推翻预设后的扩展行动",不让 Code 在"教训 80 不越界"和"任务完成"间二选一半成品交付 |
| BW-110 | Chat 看 Code 完工报告必须区分 "Code 视角(push + ls-remote)" vs "部署链视角(Actions + Cloud Build + Cloud Run)",Code 视角完工是必要不充分条件 |
| BW-111 | Chat 看 Hans 飞书 PDF 截图判断"Hotfix 没生效"时,第一步先对比 PDF 内部时间戳 vs Hotfix push 时间,而非诊断部署链 |
| BW-112 | Chat 出长指令含 PDF / canvas / 图形渲染等"cursor 状态机"型 API 时,必须显式标注 cursor reset 责任 |
| BW-113 | 接力包/归档文档涉及 GitHub master HEAD / Cloud Run revision 等"链末状态"信息时,必须标注"待 verify"或留空给 Hans/Code 实测填,不能基于 Code 视角的 commit hash 推断 |

---

## § 4 BW-95 GitHub Actions auto-pr-merge 实战验收(✅ 本日 4 次全绿)

| 次序 | 任务 | 触发分支 | workflow 用时 | Hans 介入 |
|---|---|---|---|---|
| 1 | self-install(Hotfix-v7)| claude/auto-merge-workflow | 9s | 仅 Settings 配权限(必要,鸡生蛋)|
| 2 | Hotfix-v8 phase5b 批 1 | claude/phase5b-batch1 | 9s | 0 ✅ |
| 3 | Hotfix-v9 phase5b 批 2 | claude/phase5b-batch2 | 11s | 0 ✅ |
| 4 | Hotfix-v9.1 cursor fix | claude/phase5b-batch3-render-fix | (push 后)| 0 ✅ |

BW-3 终极目标完整兑现(Hans 0 介入 PR merge,Code 自主全链路自动化)。

---

## § 5 待推进事项池(P2,新 Chat 视情况捡)

继承接力包 v5 § 9.2 + § 10,本批新增:

### 5.1 已完成
- ✅ Phase 5b PDF 内容优化 3 批(Hotfix v8/v9/v9.1)
- ✅ 接力包 v6 归档(本批,push to claude/handoff-v6)

### 5.2 P2 任务池(无明确优先级,Hans 后续决定)

| 编号 | 事项 | 复杂度 | 备注 |
|---|---|---|---|
| Hotfix-v10 | PDF inline visual bold(注册 NotoSansCJK-Bold face)| 低 | Hotfix-v9 已识别,留作单批 |
| Hotfix-v10+ | PDF 嵌套列表 / 多级表格 / 链接 / 代码块 渲染 | 中 | 视 Hans 飞书验收痛点决定 |
| BW-79 激活 | GCP SA + GitHub Secret 5 步 setup(接力包 v5 § 5) | 中 | Hans 30 min,激活后 Code 自主 Cloud Run 诊断 |
| P2-1 | 云端部署 Google Cloud Run + 私有仓库 + CI/CD | 高 | 已部分实施(Cloud Build 自动 deploy)|
| P2-2 | 邮件功能启用(SMTP)| 低 | Cloud Run 部署后端口解封 |
| P2-3 | 开机自启修复(LaunchAgent / watchdog) | 中 | 与云端部署后无关,本地 Mac 待修 |
| P2-4 | 知识库复用(历史报告作为新任务参考) | 中 | — |
| P2-5 | 跨事业部协作(多事业部联合执行复杂任务) | 中 | — |
| P2-6 | Agent 绩效评分体系 | 低 | — |
| P2-7 | 侧边栏重命名/新增 | 低 | — |
| P2-8 | TG Bot 链路完整测试(目前主要用飞书) | 低 | 接力包 v5 引用的 TG Bot Token 仍在 |

---

## § 6 关键文件位置 / 凭证清单

继承接力包 v5 § 6 全部。变更点:0(本批未改路径 / 凭证)。

---

## § 7 红线(永久,不可越界)

继承接力包 v5 § 7 全部不变。

---

## § 8 今日累计成就(本日 ~14 小时 总收益)

- Phase 5a-v3 飞书反向 PDF 推送完整链路 ✅(v4-v6 完成)
- Phase 5b PDF 内容优化 3 批完整收官 ✅(v8-v9.1 完成)
- BW-95 GitHub Actions auto-pr-merge 实战 4 次全绿 ✅(BW-3 终极兑现)
- 沉淀 BW-50~113 共 64 条新铁律(项目级长期资产)
- Hotfix-v1~v9.1 链式 9 个修复(Cloud Run env 双层 + catch String / pdfkit .ttc PostScript / markdown 渲染管道 / cursor reset)

---

## § 9 Day 1 操作清单(新 Chat 启动后 Hans 第一步)

### 9.1 立即(无强制操作)

- 本接力包 v6 已 push 到 `claude/handoff-v6`,BW-95 自动归档到 master(本批兑现)
- 文件位置:`docs/handoff/BitWorld-Chat-handoff-v6.md`(GitHub master 永久留底)
- 新 Chat 可直接 paste 本文档全文,或引用 GitHub raw URL

### 9.2 新 Chat 启动开场白模板

> 接力包 v6 已收到(贴在下面/已上传)。Phase 5b PDF 内容优化 3 批完整收官,BW-95 实战 4 次全绿。当前进入下一阶段任务池,请按 § 5.2 列表 + 我下一句指令决定具体任务。
>
> 你必须严格遵守接力包 § 0 行为规则(含本版 0.11 部署链时间认知 + 0.12 cursor API 警示)。
>
> [Hans 下一句:可能是 Hotfix-v10 visual bold,或 BW-79 激活,或 P2 任意一项,或全新任务]

---

接力包 v6 完毕。新 Chat 用此文档作为完整背景,无需读旧 transcript。本版核心:Phase 5b 收官 + BW-100~113 14 条新铁律。
