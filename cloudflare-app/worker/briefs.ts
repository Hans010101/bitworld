export type BriefDefinition = {
  id: string;
  command: string;
  label: string;
  title: string;
  scheduleId: string;
  description: string;
  outputRequirements: string;
};

export const briefMenuVersion = "2026-08-24-v1";

export const briefDefinitions: BriefDefinition[] = [
  {
    id: "finance-radar",
    command: "finance_radar",
    label: "📡 财经新闻雷达",
    title: "BitWorld 财经新闻雷达",
    scheduleId: "schedule-daily-finance-radar-0800",
    description: "扫描截至生成时刻过去24小时全球高价值财经信息，覆盖宏观经济、央行与利率、监管、主要市场、大宗商品和重要公司事件；由新闻雷达跨期去重并按决策价值排序，只保留值得持续关注的新信号。",
    outputRequirements: "中文核心摘要与PDF完整报告；精选8至12条高信号事件；每条说明事实、重要性、潜在影响及下一观察点；区分事实与判断；参考资料只保留标题、链接和发布时间。",
  },
  {
    id: "geopolitics",
    command: "brief_politics",
    label: "🌍 政治军事晨报",
    title: "全球政治与军事晨报",
    scheduleId: "schedule-daily-geopolitics-0900",
    description: "整理截至生成时刻过去24小时全球最重要的政治、外交、军事、安全与地缘冲突新闻。按重要性排序，合并重复事件，说明事件进展、各方立场、潜在影响及未来24小时观察点。",
    outputRequirements: "中文核心摘要与PDF完整报告；10至15条高信号事件；事实与分析分开；每条保留来源标题、发布时间和链接；优先政府、国际组织、通讯社及主流媒体；不得使用未经核验的传闻。",
  },
  {
    id: "finance",
    command: "brief_finance",
    label: "💹 全球财经简报",
    title: "全球财经新闻简报",
    scheduleId: "schedule-daily-finance-1000",
    description: "整理截至生成时刻过去24小时全球重要财经新闻，覆盖宏观经济、央行与利率、主要市场、外汇、大宗商品、重要公司与监管变化，并说明对资产和经营决策的影响。",
    outputRequirements: "中文核心摘要与PDF完整报告；10至15条高信号财经事件；标注市场影响方向与不确定性；每条保留来源标题、发布时间和链接；重要数据至少双源核验。",
  },
  {
    id: "crypto",
    command: "brief_crypto",
    label: "₿ 加密行业简报",
    title: "加密行业新闻简报",
    scheduleId: "schedule-daily-crypto-1700",
    description: "整理截至生成时刻过去24小时加密行业的重要新闻，覆盖监管、机构资金、交易平台、主流公链与协议、稳定币、安全事件和市场结构，不把价格波动本身当作新闻。",
    outputRequirements: "中文核心摘要与PDF完整报告；8至12条高信号事件；区分事实、市场反应与分析判断；每条保留来源标题、发布时间和链接；安全与监管事件优先使用官方来源交叉核验。",
  },
  {
    id: "justin-sun",
    command: "brief_tron",
    label: "☀️ 孙宇晨/TRON舆情",
    title: "孙宇晨与 TRON 媒体舆情日报",
    scheduleId: "schedule-daily-justin-sun-sentiment-1700",
    description: "整理截至生成时刻前48小时内，全球媒体、监管机构、TRON与HTX官方渠道及高影响力公开讨论中，与波场TRON创始人孙宇晨（Justin Sun）直接相关的报道与舆情。重点覆盖监管与法律动态、公开发言、商业与生态动作、合作与争议、媒体叙事变化、正负面舆情及其对TRON、HTX和相关品牌的潜在影响。只采用发布时间位于48小时窗口内的来源，旧报道不得作为当日事件。",
    outputRequirements: "发送简体中文核心摘要与PDF完整报告；按影响力排序整理5至10条高信号信息；每条写明媒体或发布主体、具体事件、发布时间、报道基调、舆情方向、关联影响及后续观察点；区分已核实事实、本人或官方表态、媒体评论与市场推测；合并同一事件的重复报道；参考资料只保留48小时内来源的标题、发布时间和链接；禁止输出检索状态、资料缺口、后台流程或无关的历史介绍。",
  },
  {
    id: "technology",
    command: "brief_tech",
    label: "🤖 全球科技简报",
    title: "全球科技新闻简报",
    scheduleId: "schedule-daily-tech-2000",
    description: "整理截至生成时刻过去24小时全球重要科技新闻，覆盖人工智能、芯片、云计算、网络安全、消费电子、平台公司、前沿科研与科技监管，并突出产业和商业影响。",
    outputRequirements: "中文核心摘要与PDF完整报告；10至15条高信号事件；按产业影响排序；每条说明事实、重要性与后续观察点，并保留来源标题、发布时间和链接。",
  },
  {
    id: "comprehensive",
    command: "brief_daily",
    label: "📰 全球综合日报",
    title: "全球综合新闻日报",
    scheduleId: "schedule-daily-comprehensive-2200",
    description: "汇总截至生成时刻过去24小时最值得关注的全球新闻，覆盖政治、军事、财经、科技、社会与重大突发事件；去除低价值和重复内容，形成面向决策者的每日总览。",
    outputRequirements: "中文核心摘要与PDF完整报告；精选10至15件最重要事件；先给今日五条核心结论，再按主题展开；说明跨领域关联、主要风险和未来24小时日程；每条保留来源标题、发布时间和链接。",
  },
];

const menuRequests = new Set([
  "/start",
  "/menu",
  "菜单",
  "导航",
  "简报中心",
  "打开简报中心",
]);

export function isBriefMenuRequest(value: string): boolean {
  return menuRequests.has(value.trim().toLowerCase());
}

export function briefFromInput(value: string): BriefDefinition | null {
  const normalized = value.trim();
  const lower = normalized.toLowerCase().replace(/^brief:/, "");
  return briefDefinitions.find((brief) => (
    lower === brief.id
    || lower === brief.command
    || lower === `/${brief.command}`
    || normalized === brief.label
    || normalized === brief.title
  )) ?? null;
}

export function defaultBriefObjective(brief: BriefDefinition): string {
  return [brief.title, brief.description, `交付要求：${brief.outputRequirements}`].join("\n\n");
}
