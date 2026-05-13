---
name: news-collection
description: 新闻雷达事业部的新闻采集工作方法论。当 News-002-采集 Agent 被分配采集类任务时激活。
assigned_agents:
  - News-002-采集
---

# 新闻采集工作方法论

## 采集流程

### Step 1: 来源扫描（按优先级顺序）

1. 全球宏观：Reuters, Bloomberg, FT, WSJ — 关注央行政策、地缘政治、宏观经济数据
2. 加密行业：CoinDesk, The Block, Decrypt, Foresight News — 关注项目动态、融资、监管
3. 链上异动：Arkham Intelligence, Whale Alert — 大额转账、巨鲸动向
4. 社交热度：Twitter/X 趋势（加密圈 KOL）、Reddit r/cryptocurrency — 舆论风向
5. 中文渠道：金色财经、巴比特、律动 BlockBeats — 国内视角补充

### Step 2: 筛选标准

每条新闻必须满足至少一个条件：

- 涉及 BTC/ETH 价格变动 > 3%
- 涉及市值前 20 项目的重大事件（上线、合并、漏洞、监管）
- 涉及全球前 10 经济体的宏观政策（利率、CPI、就业数据）
- 涉及加密行业融资 > $10M
- Twitter/X 上 24h 内 > 5000 次转发的加密相关讨论
- 重大安全事件（交易所被黑、协议漏洞、跑路）

### Step 3: 输出格式

每条采集结果：

```
### [序号] [标题]
- **来源**: [媒体名] | [URL] | [发布时间]
- **摘要**: 2-3 句话概括核心内容
- **影响评级**: 🔴高 / 🟡中 / 🟢低
- **相关资产**: BTC, ETH, SOL...（列出受影响的资产）
- **建议关注**: [后续发展方向的一句话判断]
```

### Step 4: 采集数量要求

- 早报采集：15-25 条（覆盖前日 18:00 至当日 08:00）
- 晚报采集：15-25 条（覆盖当日 08:00 至 18:00）
- 临时指令：根据指令范围，5-15 条

## 输出格式禁令(Phase 5b 批 2 / Hotfix-v9)

报告 markdown 必须严格遵守。Code 在 PDF 渲染前会预处理剥离这些字段(server/src/services/openai-post-run.ts:stripReportMetadata),但仍**禁止 Agent 输出**——双层防御。

### 禁止输出(头部噪音)
- ❌ `[董事长指令] ...` 前缀(不复述用户原指令)
- ❌ `**报告编号**: XXX`
- ❌ `**报告生成时间**: XXX`(时间已在 📅 顶部 metadata)
- ❌ `**数据窗口**: XXX`
- ❌ `**报告负责人**: XXX`
- ❌ `**数据来源**: XXX(状态码 / 响应时间)`(数据 inline 引用来源即可)
- ❌ 与 PDF 大标题重复的独立 H1(大标题由 Code 用 `📌 主题 | YYYY-MM-DD` 自动生成)

### 禁止输出(尾部)
- ❌ `--- 报告结束 ---` / `## 报告结束` / `**报告结束**`
- ❌ "四、数据质量说明" 整节(数据可靠性逐项 inline 标注)
- ❌ "免责声明" / "本报告由 AI 生成" 类样板

### 必填顶部 2 行
- ✅ `📌 主题: <简短主题,≤25 字,不含日期>`
- ✅ `📅 时间: YYYY-MM-DD`

### 表格规范
- 标准 markdown table:`| 列 | 列 |` + 分隔行 `|---|---|`
- Code 自动解析为 PDF 网格(renderTable)
- 不用 ASCII 艺术对齐(变宽字体下错位)

### 强调规范
- 加粗用 `**xxx**`,Code 自动剥离 markers(CJK 字体无 bold variant,visually 与正文同)
- 斜体用 `*xxx*`,同样剥离 markers
- 行内代码用 backtick `` `xxx` ``,同样剥离 markers
- 不用 `_xxx_` 下划线变体(Agent LLM 输出不稳定)

### 列表 / 序号
- 无序:`- xxx` 或 `* xxx`,Code 渲染为 `•` 项目符号
- 有序:`1. xxx` `2. xxx`,Code 保留数字 prefix
- 不用 `☐` / `▢` / `□` 等不常见 box-drawing 符号(CJK 字体可能缺字)

### 项目简介(每个具体项目 1-2 句)
- GitHub repo / 加密币种 / 新闻条目 / 舆情事件 / 公司:**功能 + 解决的问题**
- 条目 < 5:全部详细
- 条目 ≥ 10:Top 5 详细,其余 1 行简述
