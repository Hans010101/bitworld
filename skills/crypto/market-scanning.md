---
name: market-scanning
description: 加密交易事业部的市场扫描方法论。当 Crypto-005-数据 Agent 进行市场数据采集时激活。
assigned_agents:
  - Crypto-005-数据
---

# 市场扫描方法论

## 数据采集维度

### 价格数据
- BTC, ETH 实时价格及 24h/7d 涨跌幅
- 市值 Top 20 币种价格一览
- 当日涨幅 Top 10 / 跌幅 Top 10

### 衍生品数据
- 永续合约费率（BTC/ETH 主要交易所加权）
- 期权 Put/Call Ratio (PCR)
- 最大痛点价格（Max Pain）
- 未平仓合约（OI）变化及趋势

### 链上数据
- 活跃地址数（BTC/ETH 日活）
- 交易所净流入/流出（BTC/ETH）
- MVRV 比率（市场高估/低估判断）
- NUPL（净未实现盈亏）

### 资金流数据
- BTC/ETH ETF 每日净流入
- 稳定币总市值变化（USDT/USDC/DAI）
- USDT 场外溢价（OTC Premium）

### 宏观关联指标
- 美元指数 DXY
- 美债收益率（2Y/10Y 及利差）
- VIX 恐慌指数
- 黄金现货价格

## 数据来源

| 数据类型 | 首选来源 | 备选来源 |
|----------|---------|---------|
| 价格 | CoinGecko API | CoinMarketCap |
| 衍生品 | CoinGlass | Coinalyze |
| 链上 | Glassnode | CryptoQuant |
| DeFi | DefiLlama | DeFi Pulse |
| 技术图表 | TradingView | — |

## 输出格式

使用结构化 Markdown 表格，异常值用 **加粗** 标注：

```
| 指标 | 当前值 | 24h 变化 | 状态 |
|------|--------|---------|------|
| BTC | $67,432 | **+5.2%** | 🔴 异常波动 |
| ETH | $3,521 | +1.8% | 🟢 正常 |
```

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
