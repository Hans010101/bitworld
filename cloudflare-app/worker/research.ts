export type ResearchSource = {
  kind: "news" | "market" | "chain";
  publisher: string;
  title: string;
  url: string;
  publishedAt: string | null;
  fetchedAt: string;
  snippet: string;
  rawData: string;
};

export type ResearchDiagnostic = {
  provider: string;
  status: "ok" | "skipped" | "failed";
  sourceCount: number;
  detail: string;
};

export type ResearchBundle = {
  query: string;
  fetchedAt: string;
  sources: ResearchSource[];
  diagnostics: ResearchDiagnostic[];
  quality: {
    requestedSymbols: string[];
    marketPublishers: number;
    newsPublishers: number;
    professionalSearchEnabled: boolean;
  };
};

type ResearchEnv = Pick<Env, "SERPER_API_KEY" | "BOCHA_API_KEY">;

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

async function fetchExternal(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 12_000,
  attempts = 2,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === attempts - 1) return response;
      await response.body?.cancel();
    } catch (caught) {
      lastError = caught;
      if (attempt === attempts - 1) throw caught;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("外部数据源请求失败");
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function xmlTag(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function parseNewsRss(xml: string, fetchedAt: string): ResearchSource[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  return items.slice(0, 8).flatMap((item) => {
    const title = xmlTag(item, "title");
    const url = xmlTag(item, "link");
    const sourceMatch = item.match(/<source(?:\s+url="([^"]+)")?[^>]*>([\s\S]*?)<\/source>/i);
    const publisher = sourceMatch ? decodeXml(sourceMatch[2]) : "Google 新闻";
    const publisherUrl = sourceMatch?.[1] ? decodeXml(sourceMatch[1]) : "";
    const publishedValue = xmlTag(item, "pubDate");
    const publishedAt = publishedValue && !Number.isNaN(Date.parse(publishedValue))
      ? new Date(publishedValue).toISOString()
      : null;
    if (!title || !url) return [];
    return [{
      kind: "news" as const,
      publisher,
      title,
      url,
      publishedAt,
      fetchedAt,
      snippet: `新闻标题与发布时间来自实时新闻聚合结果。原始媒体：${publisher}${publisherUrl ? `（${publisherUrl}）` : ""}`,
      rawData: JSON.stringify({ publisherUrl }),
    }];
  });
}

async function fetchNews(query: string, fetchedAt: string): Promise<ResearchSource[]> {
  const target = new URL("https://news.google.com/rss/search");
  target.searchParams.set("q", query);
  target.searchParams.set("hl", "zh-CN");
  target.searchParams.set("gl", "SG");
  target.searchParams.set("ceid", "SG:zh-Hans");
  const response = await fetchExternal(target, {
    headers: { "user-agent": "BitWorld/1.0 (+https://github.com/Hans010101/bitworld)" },
  }, 15_000);
  if (!response.ok) throw new Error(`实时新闻检索返回 ${response.status}`);
  return parseNewsRss((await response.text()).slice(0, 1_000_000), fetchedAt);
}

function parsePublishedAt(value: unknown, fetchedAt?: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  const relative = normalized.match(/^(\d+)\s*(分钟|小时|天)前$/)
    ?? normalized.match(/^(\d+)\s*(minutes?|hours?|days?)\s+ago$/i);
  if (relative && fetchedAt) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const milliseconds = /分钟|minute/.test(unit)
      ? amount * 60_000
      : /小时|hour/.test(unit)
        ? amount * 3_600_000
        : amount * 86_400_000;
    return new Date(new Date(fetchedAt).getTime() - milliseconds).toISOString();
  }
  if (/^(刚刚|just now)$/i.test(normalized) && fetchedAt) return fetchedAt;
  const chineseDate = normalized.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  const timestamp = chineseDate
    ? Date.UTC(Number(chineseDate[1]), Number(chineseDate[2]) - 1, Number(chineseDate[3]))
    : Date.parse(normalized);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function sourceName(url: string, fallback: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || fallback;
  } catch {
    return fallback;
  }
}

const blockedSearchHosts = [
  /(^|\.)czsfy\.org$/i,
  /(^|\.)sxsmxyy\.com$/i,
  /(^|\.)cazyy\.com$/i,
];

function isUsableSearchResult(
  title: string,
  url: string,
  publishedAt: string | null,
  query: string,
  fetchedAt: string,
): boolean {
  let hostname = "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    hostname = parsed.hostname;
  } catch {
    return false;
  }
  if (blockedSearchHosts.some((pattern) => pattern.test(hostname))) return false;
  if (/官方下载|官方正版下载|下载\s*app|钱包\s*app\s*官网|TPwallet|你的通用数字钱包|硬件钱包-Ledger/i.test(title)) {
    return false;
  }
  if (/next big disruptor|presale|best crypto|top altcoins?|price prediction|bulls defend|referral code|off on trading fees|launches expanded cryptocurrency|could lose its status as|稳赚|暴涨币|百倍币/i.test(title)) {
    return false;
  }
  const isCryptoNewsQuery = /cryptocurrency|blockchain|bitcoin|ethereum|加密|区块链|比特币|以太坊/i.test(query);
  if (isCryptoNewsQuery) {
    const cryptoContext = /crypto|blockchain|bitcoin|ethereum|stablecoin|tokeniz|defi|web3|binance|coinbase|bitmart|coinex|clarity|sec\b|cftc|加密|区块链|比特币|以太坊|稳定币|代币化|交易所/i.test(title);
    if (!cryptoContext) return false;
    const priceFocused = /price|trades?\s+near|support|resistance|bulls?|bears?|rall(?:y|ied)|slides?|market\s+(?:recap|wrap)|dominance|trendline|profit-taking|liquidation|价格|行情|支撑位|阻力位|涨跌|技术分析/i.test(title);
    const eventFocused = /regulat|legislat|law|bill|clarity|sec\b|cftc|court|exchange|shut|clos|stablecoin|security|hack|exploit|institution|etf|protocol|launch|acqui|funding|partnership|custody|tokeniz|treasury|reserve|sanction|fraud|bankrupt|监管|法案|法院|交易所|关闭|稳定币|安全|攻击|漏洞|机构|协议|上线|收购|融资|合作|托管|代币化|储备|制裁|欺诈|破产/i.test(title);
    if (priceFocused && !eventFocused) return false;
  }
  if (searchFreshness(query) !== "noLimit") {
    const currentYear = new Date(fetchedAt).getUTCFullYear();
    const titleYears = [...title.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
    if (titleYears.some((year) => year < currentYear)) return false;
    if (publishedAt && Date.parse(publishedAt) < Date.parse(fetchedAt) - 32 * 86_400_000) return false;
  }
  return true;
}

function searchFreshness(query: string): "oneDay" | "oneWeek" | "oneMonth" | "noLimit" {
  if (/24\s*(?:小时|HOURS?)|今日|今天|实时|当天/i.test(query)) return "oneDay";
  if (/近\s*(?:7|七)\s*天|最近一周|本周/i.test(query)) return "oneWeek";
  if (/近\s*(?:30|三十)\s*天|最近一个月|本月|近期/i.test(query)) return "oneMonth";
  return "noLimit";
}

async function fetchSerper(query: string, fetchedAt: string, apiKey: string): Promise<ResearchSource[]> {
  const freshness = searchFreshness(query);
  const newsFocused = freshness !== "noLimit"
    || /when:\d|新闻|消息|事件|政策|动态|舆情|行情|走势|市场/i.test(query);
  const timeFilter = freshness === "oneDay"
    ? "qdr:d"
    : freshness === "oneWeek"
      ? "qdr:w"
      : freshness === "oneMonth"
        ? "qdr:m"
        : undefined;
  const response = await fetchExternal(`https://google.serper.dev/${newsFocused ? "news" : "search"}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      q: query,
      gl: "sg",
      hl: "zh-cn",
      num: 10,
      ...(timeFilter ? { tbs: timeFilter } : {}),
    }),
  }, 15_000);
  if (!response.ok) throw new Error(`Serper 返回 ${response.status}`);
  const payload = await response.json<{
    news?: Array<{
      title?: string;
      link?: string;
      snippet?: string;
      date?: string;
      source?: string;
      position?: number;
    }>;
    organic?: Array<{
      title?: string;
      link?: string;
      snippet?: string;
      date?: string;
      position?: number;
    }>;
  }>();
  const results = payload.news ?? payload.organic ?? [];
  return results.slice(0, 10).flatMap((item) => {
    if (!item.title || !item.link) return [];
    const publishedAt = parsePublishedAt(item.date, fetchedAt);
    if (!isUsableSearchResult(item.title, item.link, publishedAt, query, fetchedAt)) return [];
    return [{
      kind: "news" as const,
      publisher: ("source" in item && typeof item.source === "string" && item.source)
        ? item.source
        : sourceName(item.link, "Serper"),
      title: item.title,
      url: item.link,
      publishedAt,
      fetchedAt,
      snippet: `${item.snippet?.trim() || "搜索结果未提供摘要。"}${item.date ? `；搜索结果标注时间：${item.date}` : ""}`,
      rawData: JSON.stringify({ searchProvider: "Serper", position: item.position, date: item.date }),
    }];
  });
}

async function fetchBocha(query: string, fetchedAt: string, apiKey: string): Promise<ResearchSource[]> {
  const response = await fetchExternal("https://api.bochaai.com/v1/web-search", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query,
      freshness: searchFreshness(query),
      summary: true,
      count: 10,
    }),
  }, 18_000);
  if (!response.ok) throw new Error(`博查搜索返回 ${response.status}`);
  const payload = await response.json<{
    data?: {
      webPages?: {
        value?: Array<{
          name?: string;
          url?: string;
          siteName?: string;
          snippet?: string;
          summary?: string;
          datePublished?: string;
        }>;
      };
    };
    webPages?: {
      value?: Array<{
        name?: string;
        url?: string;
        siteName?: string;
        snippet?: string;
        summary?: string;
        datePublished?: string;
      }>;
    };
  }>();
  const values = payload.data?.webPages?.value ?? payload.webPages?.value ?? [];
  return values.slice(0, 10).flatMap((item) => {
    if (!item.name || !item.url) return [];
    const publishedAt = parsePublishedAt(item.datePublished, fetchedAt);
    if (!isUsableSearchResult(item.name, item.url, publishedAt, query, fetchedAt)) return [];
    const summary = item.summary?.trim() || item.snippet?.trim() || "搜索结果未提供摘要。";
    return [{
      kind: "news" as const,
      publisher: item.siteName || sourceName(item.url, "博查搜索"),
      title: item.name,
      url: item.url,
      publishedAt,
      fetchedAt,
      snippet: summary.slice(0, 1_200),
      rawData: JSON.stringify({ searchProvider: "Bocha", datePublished: item.datePublished }),
    }];
  });
}

const coinIds: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  TRX: "tron",
  SOL: "solana",
  XRP: "ripple",
  BNB: "binancecoin",
  DOGE: "dogecoin",
};

const coinPaprikaIds: Record<string, string> = {
  BTC: "btc-bitcoin",
  ETH: "eth-ethereum",
  TRX: "trx-tron",
  SOL: "sol-solana",
  XRP: "xrp-xrp",
  BNB: "bnb-binance-coin",
  DOGE: "doge-dogecoin",
};

const krakenPairs: Record<string, string> = {
  BTC: "XBTUSD",
  ETH: "ETHUSD",
  TRX: "TRXUSD",
  SOL: "SOLUSD",
  XRP: "XRPUSD",
  DOGE: "XDGUSD",
};

const coinAliases: Record<string, RegExp> = {
  BTC: /比特币|BITCOIN|XBT|大饼/i,
  ETH: /以太坊|以太币|ETHEREUM/i,
  TRX: /波场|TRON/i,
  SOL: /索拉纳|SOLANA/i,
  XRP: /瑞波币|RIPPLE/i,
  BNB: /币安币|BINANCE\s*COIN/i,
  DOGE: /狗狗币|DOGECOIN/i,
};

const coinSearchTerms: Record<string, string> = {
  BTC: "(Bitcoin OR BTC OR 比特币)",
  ETH: "(Ethereum OR ETH OR 以太坊)",
  TRX: "(TRON OR TRX OR 波场)",
  SOL: "(Solana OR SOL OR 索拉纳)",
  XRP: "(XRP OR Ripple OR 瑞波币)",
  BNB: "(BNB OR Binance Coin OR 币安币)",
  DOGE: "(Dogecoin OR DOGE OR 狗狗币)",
};

function requestedSymbols(query: string): string[] {
  const upper = query.toUpperCase();
  const explicit = Object.keys(coinIds).filter((symbol) => new RegExp(`(^|[^A-Z])${symbol}([^A-Z]|$)`).test(upper));
  const aliases = Object.entries(coinAliases)
    .filter(([, pattern]) => pattern.test(query))
    .map(([symbol]) => symbol);
  const matched = [...new Set([...explicit, ...aliases])];
  if (matched.length) return matched;
  const isBroadCryptoTask = /加密|币圈|数字资产|CRYPTO/.test(upper);
  const requestsMarketData = /价格(?:走势|趋势|分析|预测|区间)|行情(?:分析|走势|报告)|走势(?:分析|预测)|涨跌幅|成交量|市值|K\s*线|技术分析|支撑位|阻力位|资金流|持仓|清算/i.test(query);
  return isBroadCryptoTask && requestsMarketData ? ["BTC", "ETH"] : [];
}

function taskSearchQuery(query: string, symbols: string[]): string {
  const isNewsBrief = /新闻|简报|日报|要闻|资讯/.test(query);
  const recency = /24\s*(?:小时|HOURS?)|今日|今天|实时|当天/i.test(query) ? " past 24 hours" : "";
  if (!symbols.length && isNewsBrief && /加密|币圈|数字资产|区块链|CRYPTO/i.test(query)) {
    return `(cryptocurrency OR blockchain) (regulation OR legislation OR exchange OR stablecoin OR security OR hack OR institutional OR protocol) latest news -price -prediction${recency}`;
  }
  if (isNewsBrief && /政治|军事|外交|地缘|国际安全/.test(query)) {
    return `(global politics OR military OR diplomacy OR geopolitical security) latest news${recency}`;
  }
  if (isNewsBrief && /财经|宏观|金融|股市|债市|央行/.test(query)) {
    return `(global finance OR economy OR central bank OR stocks OR bonds) latest news${recency}`;
  }
  if (isNewsBrief && /科技|人工智能|AI|半导体|互联网|网络安全/i.test(query)) {
    return `(technology OR AI OR semiconductor OR cybersecurity) latest news${recency}`;
  }
  const meaningfulLines = query.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return meaningfulLines.slice(0, 2).join(" ").slice(0, 240);
}

function externalNewsQuery(query: string, symbols: string[]): string {
  const timeFilter = /24\s*(?:小时|HOURS?)|今日|今天|实时|当天/i.test(query) ? " when:1d" : "";
  if (!symbols.length) return `${query}${timeFilter}`;
  const assetTerms = symbols.map((symbol) => coinSearchTerms[symbol]).filter(Boolean).join(" OR ");
  return `${query} (${assetTerms})${timeFilter}`;
}

async function fetchCoinGecko(symbols: string[], fetchedAt: string): Promise<ResearchSource[]> {
  const ids = symbols.map((symbol) => coinIds[symbol]).filter(Boolean);
  if (!ids.length) return [];
  const target = new URL("https://api.coingecko.com/api/v3/simple/price");
  target.searchParams.set("ids", ids.join(","));
  target.searchParams.set("vs_currencies", "usd");
  target.searchParams.set("include_24hr_change", "true");
  target.searchParams.set("include_last_updated_at", "true");
  const response = await fetchExternal(target);
  if (!response.ok) throw new Error(`CoinGecko 返回 ${response.status}`);
  const payload = await response.json<Record<string, { usd?: number; usd_24h_change?: number; last_updated_at?: number }>>();
  return symbols.flatMap((symbol) => {
    const value = payload[coinIds[symbol]];
    if (!value || typeof value.usd !== "number") return [];
    const publishedAt = value.last_updated_at ? new Date(value.last_updated_at * 1000).toISOString() : fetchedAt;
    return [{
      kind: "market" as const,
      publisher: "CoinGecko",
      title: `${symbol}/USD 即时报价`,
      url: target.toString(),
      publishedAt,
      fetchedAt,
      snippet: `${symbol} 现价 ${value.usd} 美元；24 小时变动 ${typeof value.usd_24h_change === "number" ? value.usd_24h_change.toFixed(2) : "未提供"}%。`,
      rawData: JSON.stringify(value),
    }];
  });
}

async function fetchCoinPaprika(symbols: string[], fetchedAt: string): Promise<ResearchSource[]> {
  const values = await Promise.all(symbols.map(async (symbol) => {
    const id = coinPaprikaIds[symbol];
    if (!id) return null;
    const target = `https://api.coinpaprika.com/v1/tickers/${id}`;
    const response = await fetchExternal(target, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`CoinPaprika ${symbol} 返回 ${response.status}`);
    const payload = await response.json<{
      last_updated?: string;
      quotes?: {
        USD?: {
          price?: number;
          volume_24h?: number;
          market_cap?: number;
          percent_change_24h?: number;
          percent_change_7d?: number;
        };
      };
    }>();
    const usd = payload.quotes?.USD;
    if (typeof usd?.price !== "number") return null;
    return {
      kind: "market" as const,
      publisher: "CoinPaprika",
      title: `${symbol}/USD 即时市场数据`,
      url: target,
      publishedAt: payload.last_updated ?? fetchedAt,
      fetchedAt,
      snippet: `${symbol} 现价 ${usd.price} 美元；24 小时/7 日变动 ${usd.percent_change_24h ?? "未提供"}% / ${usd.percent_change_7d ?? "未提供"}%；24 小时成交额 ${usd.volume_24h ?? "未提供"} 美元；市值 ${usd.market_cap ?? "未提供"} 美元。`,
      rawData: JSON.stringify(payload),
    };
  }));
  return values.filter((value): value is NonNullable<typeof value> => value !== null);
}

async function fetchKraken(symbols: string[], fetchedAt: string): Promise<ResearchSource[]> {
  const values = await Promise.all(symbols.map(async (symbol) => {
    const pair = krakenPairs[symbol];
    if (!pair) return null;
    const target = new URL("https://api.kraken.com/0/public/Ticker");
    target.searchParams.set("pair", pair);
    const response = await fetchExternal(target, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Kraken ${symbol} 返回 ${response.status}`);
    const payload = await response.json<{
      error?: string[];
      result?: Record<string, {
        c?: string[];
        v?: string[];
        p?: string[];
        l?: string[];
        h?: string[];
        o?: string;
      }>;
    }>();
    if (payload.error?.length) throw new Error(`Kraken ${symbol}: ${payload.error.join(", ")}`);
    const value = Object.values(payload.result ?? {})[0];
    if (!value?.c?.[0]) return null;
    const open = Number(value.o);
    const last = Number(value.c[0]);
    const change = Number.isFinite(open) && open !== 0 ? ((last - open) / open) * 100 : null;
    return {
      kind: "market" as const,
      publisher: "Kraken",
      title: `${symbol}/USD 交易所行情`,
      url: target.toString(),
      publishedAt: fetchedAt,
      fetchedAt,
      snippet: `最新成交价 ${value.c[0]} 美元；相对今日开盘变动 ${change === null ? "未提供" : `${change.toFixed(2)}%`}；24 小时高/低 ${value.h?.[1] ?? "未提供"}/${value.l?.[1] ?? "未提供"}；24 小时成交量 ${value.v?.[1] ?? "未提供"} ${symbol}；成交量加权均价 ${value.p?.[1] ?? "未提供"} 美元。`,
      rawData: JSON.stringify(value),
    };
  }));
  return values.filter((value): value is NonNullable<typeof value> => value !== null);
}

async function fetchKrakenOhlc(symbols: string[], fetchedAt: string): Promise<ResearchSource[]> {
  const values = await Promise.all(symbols.map(async (symbol) => {
    const pair = krakenPairs[symbol];
    if (!pair) return null;
    const target = new URL("https://api.kraken.com/0/public/OHLC");
    target.searchParams.set("pair", pair);
    target.searchParams.set("interval", "1440");
    const response = await fetchExternal(target, {
      headers: { accept: "application/json" },
    }, 15_000);
    if (!response.ok) throw new Error(`Kraken OHLC ${symbol} 返回 ${response.status}`);
    const payload = await response.json<{
      error?: string[];
      result?: Record<string, number | Array<Array<number | string>>>;
    }>();
    if (payload.error?.length) throw new Error(`Kraken OHLC ${symbol}: ${payload.error.join(", ")}`);
    const rows = Object.entries(payload.result ?? {})
      .find(([key, value]) => key !== "last" && Array.isArray(value))?.[1];
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const period = rows.slice(-31);
    const first = period[0];
    const last = period.at(-1)!;
    const firstClose = Number(first[4]);
    const lastClose = Number(last[4]);
    const high = Math.max(...period.map((row) => Number(row[2])));
    const low = Math.min(...period.map((row) => Number(row[3])));
    const volume = period.reduce((sum, row) => sum + Number(row[6] ?? 0), 0);
    const change = Number.isFinite(firstClose) && firstClose !== 0
      ? ((lastClose - firstClose) / firstClose) * 100
      : null;
    const from = new Date(Number(first[0]) * 1000).toISOString();
    const to = new Date(Number(last[0]) * 1000).toISOString();
    return {
      kind: "market" as const,
      publisher: "Kraken",
      title: `${symbol}/USD 近 30 日日线趋势`,
      url: target.toString(),
      publishedAt: to,
      fetchedAt,
      snippet: `日线区间 ${from.slice(0, 10)} 至 ${to.slice(0, 10)}（最后一根可能尚未收盘）；首尾收盘价 ${firstClose}/${lastClose} 美元，区间变动 ${change === null ? "未提供" : `${change.toFixed(2)}%`}；区间高/低 ${high}/${low} 美元；累计成交量 ${Math.round(volume).toLocaleString("en-US")} ${symbol}。`,
      rawData: JSON.stringify(period),
    };
  }));
  return values.filter((value): value is NonNullable<typeof value> => value !== null);
}

async function fetchOkx(symbols: string[], fetchedAt: string): Promise<ResearchSource[]> {
  return Promise.all(symbols.map(async (symbol) => {
    const target = new URL("https://www.okx.com/api/v5/market/ticker");
    target.searchParams.set("instId", `${symbol}-USDT`);
    const response = await fetchExternal(target, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`OKX ${symbol} 返回 ${response.status}`);
    const payload = await response.json<{
      code?: string;
      msg?: string;
      data?: Array<{
        last?: string;
        open24h?: string;
        high24h?: string;
        low24h?: string;
        vol24h?: string;
        volCcy24h?: string;
        ts?: string;
      }>;
    }>();
    const value = payload.data?.[0];
    if (payload.code !== "0" || !value?.last) throw new Error(`OKX ${symbol}: ${payload.msg || "未返回行情"}`);
    const open = Number(value.open24h);
    const last = Number(value.last);
    const change = Number.isFinite(open) && open !== 0 ? ((last - open) / open) * 100 : null;
    return {
      kind: "market" as const,
      publisher: "OKX",
      title: `${symbol}/USDT 24 小时行情`,
      url: target.toString(),
      publishedAt: value.ts ? new Date(Number(value.ts)).toISOString() : fetchedAt,
      fetchedAt,
      snippet: `最新价 ${value.last} USDT；24 小时变动 ${change === null ? "未提供" : `${change.toFixed(2)}%`}；高/低 ${value.high24h ?? "未提供"}/${value.low24h ?? "未提供"}；成交量 ${value.vol24h ?? "未提供"} ${symbol}，计价成交额 ${value.volCcy24h ?? "未提供"} USDT。`,
      rawData: JSON.stringify(value),
    };
  }));
}

async function fetchKuCoin(symbols: string[], fetchedAt: string): Promise<ResearchSource[]> {
  return Promise.all(symbols.map(async (symbol) => {
    const target = new URL("https://api.kucoin.com/api/v1/market/stats");
    target.searchParams.set("symbol", `${symbol}-USDT`);
    const response = await fetchExternal(target, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`KuCoin ${symbol} 返回 ${response.status}`);
    const payload = await response.json<{
      code?: string;
      data?: {
        time?: number;
        last?: string;
        changeRate?: string;
        high?: string;
        low?: string;
        vol?: string;
        volValue?: string;
      };
    }>();
    const value = payload.data;
    if (payload.code !== "200000" || !value?.last) throw new Error(`KuCoin ${symbol} 未返回行情`);
    return {
      kind: "market" as const,
      publisher: "KuCoin",
      title: `${symbol}/USDT 24 小时行情`,
      url: target.toString(),
      publishedAt: value.time ? new Date(value.time).toISOString() : fetchedAt,
      fetchedAt,
      snippet: `最新价 ${value.last} USDT；24 小时变动 ${value.changeRate ? (Number(value.changeRate) * 100).toFixed(2) : "未提供"}%；高/低 ${value.high ?? "未提供"}/${value.low ?? "未提供"}；成交量 ${value.vol ?? "未提供"} ${symbol}，成交额 ${value.volValue ?? "未提供"} USDT。`,
      rawData: JSON.stringify(value),
    };
  }));
}

async function fetchBinance(symbols: string[], fetchedAt: string): Promise<ResearchSource[]> {
  const values = await Promise.all(symbols.map(async (symbol) => {
    const target = new URL("https://api.binance.com/api/v3/ticker/24hr");
    target.searchParams.set("symbol", `${symbol}USDT`);
    const response = await fetchExternal(target);
    if (!response.ok) throw new Error(`Binance ${symbol} 返回 ${response.status}`);
    const payload = await response.json<Record<string, string>>();
    return {
      kind: "market" as const,
      publisher: "Binance",
      title: `${symbol}/USDT 24 小时行情`,
      url: target.toString(),
      publishedAt: payload.closeTime ? new Date(Number(payload.closeTime)).toISOString() : fetchedAt,
      fetchedAt,
      snippet: `最新价 ${payload.lastPrice} USDT；24 小时变动 ${payload.priceChangePercent}%；高/低 ${payload.highPrice}/${payload.lowPrice}；成交额 ${payload.quoteVolume} USDT。`,
      rawData: JSON.stringify(payload),
    };
  }));
  return values;
}

async function fetchDefiLlama(query: string, fetchedAt: string): Promise<ResearchSource[]> {
  if (!/TRX|TRON|波场|TVL|DEFI|链上/i.test(query)) return [];
  const target = "https://api.llama.fi/v2/chains";
  const response = await fetchExternal(target);
  if (!response.ok) throw new Error(`DefiLlama 返回 ${response.status}`);
  const rows = await response.json<Array<{ name?: string; tokenSymbol?: string; tvl?: number; change_1d?: number; change_7d?: number; change_1m?: number }>>();
  const wanted = /TRX|TRON|波场/i.test(query) ? ["Tron"] : [];
  const selected = rows.filter((row) => wanted.length ? wanted.includes(row.name ?? "") : (row.tvl ?? 0) > 0).slice(0, wanted.length ? 3 : 5);
  return selected.map((row) => ({
    kind: "chain" as const,
    publisher: "DefiLlama",
    title: `${row.name ?? "公链"} TVL`,
    url: target,
    publishedAt: fetchedAt,
    fetchedAt,
    snippet: `TVL ${Math.round(row.tvl ?? 0).toLocaleString("en-US")} 美元；1 日/7 日/30 日变动 ${row.change_1d ?? "未提供"}% / ${row.change_7d ?? "未提供"}% / ${row.change_1m ?? "未提供"}%。`,
    rawData: JSON.stringify(row),
  }));
}

function deduplicateSources(sources: ResearchSource[]): ResearchSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const normalizedTitle = source.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const key = source.kind === "news"
      ? (normalizedTitle.slice(0, 56) || source.url)
      : `${source.publisher}:${normalizedTitle || source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function collectLatestResearch(query: string, env: ResearchEnv): Promise<ResearchBundle> {
  const fetchedAt = new Date().toISOString();
  const symbols = requestedSymbols(query);
  const conciseQuery = taskSearchQuery(query, symbols);
  const newsQuery = externalNewsQuery(conciseQuery, symbols);
  const jobs: Array<{ name: string; request: Promise<ResearchSource[]> }> = [
    { name: "Google 新闻", request: fetchNews(newsQuery, fetchedAt) },
  ];
  if (symbols.length) {
    // 四个互相独立的数据源足以完成交叉核验，同时把最坏情况下的
    // 子请求数量控制在 Cloudflare Worker 单次执行限额之内。
    jobs.push(
      { name: "CoinPaprika", request: fetchCoinPaprika(symbols, fetchedAt) },
      { name: "Kraken", request: fetchKraken(symbols, fetchedAt) },
      { name: "Kraken OHLC", request: fetchKrakenOhlc(symbols, fetchedAt) },
      { name: "OKX", request: fetchOkx(symbols, fetchedAt) },
    );
  }
  if (/TRX|TRON|波场|TVL|DEFI|链上/i.test(query)) {
    jobs.push({ name: "DefiLlama", request: fetchDefiLlama(query, fetchedAt) });
  }
  if (env.BOCHA_API_KEY?.trim()) {
    jobs.push({ name: "博查搜索", request: fetchBocha(conciseQuery, fetchedAt, env.BOCHA_API_KEY.trim()) });
  }
  if (env.SERPER_API_KEY?.trim()) {
    jobs.push({ name: "Serper", request: fetchSerper(conciseQuery, fetchedAt, env.SERPER_API_KEY.trim()) });
  }
  const settled = await Promise.allSettled(jobs.map((job) => job.request));
  const sources = deduplicateSources(
    settled.flatMap((result) => result.status === "fulfilled" ? result.value : []),
  );
  const diagnostics: ResearchDiagnostic[] = settled.map((result, index) => result.status === "fulfilled"
    ? {
        provider: jobs[index].name,
        status: "ok",
        sourceCount: result.value.length,
        detail: result.value.length ? "已取得可核验来源" : "本任务不适用或未返回结果",
      }
    : {
        provider: jobs[index].name,
        status: "failed",
        sourceCount: 0,
        detail: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
  if (!env.BOCHA_API_KEY?.trim()) {
    diagnostics.push({ provider: "博查搜索", status: "skipped", sourceCount: 0, detail: "尚未配置 BOCHA_API_KEY" });
  }
  if (!env.SERPER_API_KEY?.trim()) {
    diagnostics.push({ provider: "Serper", status: "skipped", sourceCount: 0, detail: "尚未配置 SERPER_API_KEY" });
  }
  const failedDiagnostics = diagnostics.filter((item) => item.status === "failed");
  if (failedDiagnostics.length) {
    console.warn(JSON.stringify({
      event: "research_provider_degraded",
      query,
      failures: failedDiagnostics,
    }));
  }
  const marketPublishers = new Set(
    sources.filter((source) => source.kind === "market").map((source) => source.publisher),
  ).size;
  const newsPublishers = new Set(
    sources.filter((source) => source.kind === "news").map((source) => source.publisher),
  ).size;
  const professionalSearchEnabled = Boolean(env.BOCHA_API_KEY?.trim() || env.SERPER_API_KEY?.trim());
  if (!sources.length) {
    const diagnosticSummary = diagnostics
      .map((item) => `${item.provider}:${item.status}/${item.sourceCount}${item.status === "failed" ? `(${item.detail.slice(0, 80)})` : ""}`)
      .join("；");
    throw new Error(`当前实时数据源均未返回可核验内容，本次报告已安全中止，不会使用模型旧记忆补写。数据源诊断：${diagnosticSummary}`);
  }
  if (symbols.length && marketPublishers < 2) {
    throw new Error("加密市场任务未取得至少两个独立实时行情来源，本次报告已安全中止，避免输出单一来源或过期数据。");
  }
  if (/新闻|简报|日报|要闻|资讯/.test(query)) {
    const newsSourceCount = sources.filter((source) => source.kind === "news").length;
    if (newsSourceCount < 5 || newsPublishers < 3) {
      throw new Error("新闻简报未取得至少五条、来自三个独立发布方的实时资料，本次报告已安全中止，避免用低覆盖或单一来源内容交付。");
    }
  }
  const selectedSources = [
    ...sources.filter((source) => source.kind === "market"),
    ...sources.filter((source) => source.kind === "chain"),
    ...sources.filter((source) => source.kind === "news"),
  ].slice(0, 24);
  return {
    query,
    fetchedAt,
    sources: selectedSources,
    diagnostics,
    quality: {
      requestedSymbols: symbols,
      marketPublishers,
      newsPublishers,
      professionalSearchEnabled,
    },
  };
}

export function researchPrompt(bundle: ResearchBundle): string {
  const verifiedWindows = bundle.sources.flatMap((source) => (
    [...`${source.title} ${source.snippet}`.matchAll(/(?:近\s*)?(\d+)\s*日/g)]
      .map((match) => Number(match[1]))
  ));
  const longestWindow = verifiedWindows.length ? Math.max(...verifiedWindows) : 0;
  return [
    `实时检索时间：${bundle.fetchedAt}`,
    "以下资料是本次任务唯一可用于最新事实、价格、日期和事件的外部证据。新闻标题只是线索，不得把标题中的观点当作已证实事实；数值优先交叉核对市场 API。",
    ...bundle.sources.map((source, index) => (
      `[S${index + 1}] ${source.title}｜${source.publisher}｜发布时间 ${source.publishedAt ?? "未提供"}｜抓取时间 ${source.fetchedAt}\n${source.snippet}\n${source.url}`
    )),
    `证据覆盖：${bundle.quality.marketPublishers} 个独立行情发布方、${bundle.quality.newsPublishers} 个新闻/网页发布方；专业搜索 API ${bundle.quality.professionalSearchEnabled ? "已启用" : "尚未启用，本次使用公开来源与结构化市场 API"}。`,
    `强制规则：涉及外部事实时在句末标注 [S编号]；无来源支持的数字或事件必须删除或明确写“未核验”；结论中必须说明数据截止时间。${longestWindow ? `当前历史序列最长只覆盖 ${longestWindow} 日，严禁声称更长的行情窗口。` : "当前没有历史序列，不得自行声称趋势窗口。"}所有 0.x 形式的价格和比率必须直接取自以上来源，不得用模型记忆补值。区间高点不得称为“历史高点/历史新高”。若没有新闻/网页来源，不得解释价格波动的事件原因，只能陈述可核验的行情与技术事实。聚合平台的全市场成交额与单个或少数交易所成交额统计范围不同，两者差额是正常的覆盖范围差异，不能据此推断“成交量不透明”“未验证成交量占比”或流动性风险；除非来源提供同口径数据，否则不得计算交易所市场份额。`,
  ].join("\n\n");
}
