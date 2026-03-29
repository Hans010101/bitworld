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
