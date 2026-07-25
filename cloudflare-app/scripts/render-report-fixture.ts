import { mkdir, writeFile } from "node:fs/promises";
import { reportHtml, type PdfReportInput } from "../worker/report-pdf";

const outputDir = new URL("../tmp/pdfs/", import.meta.url);

const fixture: PdfReportInput = {
  title: "BTC 近期价格趋势与风险展望",
  executiveSummary: `**核心判断：** BTC 当前处于高波动区间，短期方向仍取决于现货资金、衍生品杠杆与宏观流动性的共同变化。

- 价格动量仍在，但追涨的风险收益比已经下降。
- 资金费率与持仓量若同步快速上升，应警惕杠杆驱动的回撤。
- 更稳健的做法是围绕关键区间分批决策，并设置清晰的失效条件。`,
  content: `## 一、研究范围与口径

本报告围绕用户关心的近期价格趋势展开，重点观察现货价格结构、成交与资金流、衍生品杠杆以及可能改变短期路径的事件催化。分析结论只覆盖公开数据能够支持的时间窗口，不把区间判断外推为长期价格承诺。[S1]

## 二、当前市场结构

### 2.1 价格与成交

近期价格维持震荡上行，但日内回撤幅度同步放大。若价格创新高而现货成交未同步扩张，行情的持续性将更多依赖杠杆资金，脆弱性随之增加。[S1]

| 观察维度 | 当前信号 | 含义 | 后续验证 |
|---|---|---|---|
| 价格结构 | 高位震荡 | 多空分歧扩大 | 是否守住关键支撑 |
| 现货成交 | 温和改善 | 有真实买盘但不强 | 成交能否连续扩张 |
| 衍生品 | 杠杆偏高 | 回撤时易触发清算 | 资金费率与持仓量 |

### 2.2 资金与杠杆

资金费率反映永续合约多空持仓的资金成本。当价格、持仓量与正资金费率同时快速上升时，通常意味着多头拥挤度提高；这并不必然导致下跌，但会放大负面事件出现后的被动去杠杆。[S2]

## 三、关键驱动因素

1. **现货资金延续性。** 持续净流入可以提高回撤后的承接能力。
2. **宏观流动性预期。** 利率、美元与风险偏好变化会影响加密资产的估值弹性。
3. **监管和行业事件。** 交易平台、托管或政策事件可能在低流动性时段放大波动。[S3]

> 判断重点不是预测单一价格点位，而是识别哪些变量正在增强或削弱当前趋势。

## 四、未来情景

### 基准情景

价格维持区间震荡，现货资金保持中性偏正，杠杆逐步消化。该情景下更适合等待确认，避免在区间中部频繁追逐短线信号。

### 上行情景

现货成交与资金流同步增强，价格突破后回踩有效，衍生品杠杆没有异常扩张。上行情景失效的主要信号是突破后快速跌回原区间。

### 下行情景

资金费率和持仓量继续上升，但现货买盘减弱；一旦关键支撑失守，连锁清算可能使回撤速度明显快于上涨阶段。

## 五、风险与限制

- 公开行情数据可能因交易所、交易对和采样时间不同而存在差异。
- 单一技术指标不能证明趋势延续，也不能独立构成行动依据。
- 突发政策、安全与托管事件可能使历史相关性暂时失效。

## 六、结论与行动建议

当前更重要的不是给出一个孤立目标价，而是建立条件化决策：在现货资金确认、杠杆不过热且关键支撑有效时保留上行情景；当价格与现货成交背离、杠杆快速上升或关键支撑失守时，及时降低风险暴露。`,
  generatedAt: "2026-07-25T10:30:00+08:00",
  sourceCutoffAt: "2026-07-25T10:25:00+08:00",
  sources: [
    {
      kind: "market",
      publisher: "CoinGecko",
      title: "Bitcoin price and market data",
      url: "https://www.coingecko.com/en/coins/bitcoin",
      publishedAt: "2026-07-25",
      fetchedAt: "2026-07-25T10:25:00+08:00",
      snippet: "公开市场价格、成交量与市值数据，用于观察近期价格结构。",
      rawData: "{}",
    },
    {
      kind: "market",
      publisher: "CoinGlass",
      title: "Bitcoin futures data",
      url: "https://www.coinglass.com/",
      publishedAt: "2026-07-25",
      fetchedAt: "2026-07-25T10:25:00+08:00",
      snippet: "公开衍生品持仓量、资金费率与清算数据，用于评估杠杆拥挤度。",
      rawData: "{}",
    },
    {
      kind: "news",
      publisher: "Federal Reserve",
      title: "Monetary policy information",
      url: "https://www.federalreserve.gov/monetarypolicy.htm",
      publishedAt: "2026-07-25",
      fetchedAt: "2026-07-25T10:25:00+08:00",
      snippet: "官方货币政策资料，用于核对宏观流动性相关事件与时间。",
      rawData: "{}",
    },
  ],
};

await mkdir(outputDir, { recursive: true });
await writeFile(new URL("professional-report-fixture.html", outputDir), reportHtml(fixture), "utf8");
