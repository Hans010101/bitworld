---
name: news-translation
description: 新闻雷达事业部的编译整理方法论。当 News-004-编译 Agent 将英文来源翻译编译为中文内容时激活。
assigned_agents:
  - News-004-编译
---

# 编译整理方法论

## 翻译原则

1. 不是逐字翻译，是"编译"——用中文读者的思维重新组织信息
2. 长篇英文报道压缩为核心信息，保留关键引语
3. 补充中国市场视角的关联（如：美国 CPI 数据发布 → 对 A 股/港股加密概念股的潜在影响）

## 专有名词处理

- 人名：首次出现用"中文（英文原名）"，后续用中文，如"鲍威尔（Jerome Powell）"
- 机构名：知名机构用中文通用译名（美联储、证交会），不知名的保留英文
- 项目名：保留英文（Ethereum、Solana、Uniswap），不翻译为中文
- 术语：DeFi、NFT、Layer2、MEV 等行业术语保留英文

## 引语处理

- 重要人物的关键表态保留双语：
  中文译文「英文原文」
  例：鲍威尔表示"通胀仍在回落的轨道上"「Inflation is still on the path back down」

## 数据本地化

- 美元金额保留 $ 符号，必要时括号内注明人民币估算
- 时间全部转换为北京时间并标注 CST
- 美股代码保留原样（如 MSTR、COIN）

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
