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

export type ResearchBundle = {
  query: string;
  fetchedAt: string;
  sources: ResearchSource[];
};

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
  const response = await fetch(target, {
    headers: { "user-agent": "BitWorld/1.0 (+https://github.com/Hans010101/bitworld)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`实时新闻检索返回 ${response.status}`);
  return parseNewsRss((await response.text()).slice(0, 1_000_000), fetchedAt);
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

function requestedSymbols(query: string): string[] {
  const upper = query.toUpperCase();
  const explicit = Object.keys(coinIds).filter((symbol) => new RegExp(`(^|[^A-Z])${symbol}([^A-Z]|$)`).test(upper));
  if (explicit.length) return explicit;
  return /加密|币圈|数字资产|区块链|CRYPTO|BITCOIN/.test(upper) ? ["BTC", "ETH", "TRX"] : [];
}

async function fetchCoinGecko(symbols: string[], fetchedAt: string): Promise<ResearchSource[]> {
  const ids = symbols.map((symbol) => coinIds[symbol]).filter(Boolean);
  if (!ids.length) return [];
  const target = new URL("https://api.coingecko.com/api/v3/simple/price");
  target.searchParams.set("ids", ids.join(","));
  target.searchParams.set("vs_currencies", "usd");
  target.searchParams.set("include_24hr_change", "true");
  target.searchParams.set("include_last_updated_at", "true");
  const response = await fetch(target, { signal: AbortSignal.timeout(12_000) });
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
    const response = await fetch(target, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
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
    const response = await fetch(target, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
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
    const response = await fetch(target, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
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
    const response = await fetch(target, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
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
    const response = await fetch(target, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
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
    const response = await fetch(target, { signal: AbortSignal.timeout(12_000) });
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
  const response = await fetch(target, { signal: AbortSignal.timeout(12_000) });
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

export async function collectLatestResearch(query: string): Promise<ResearchBundle> {
  const fetchedAt = new Date().toISOString();
  const symbols = requestedSymbols(query);
  const jobs: Array<{ name: string; request: Promise<ResearchSource[]> }> = [
    { name: "Google 新闻", request: fetchNews(query, fetchedAt) },
    { name: "CoinPaprika", request: fetchCoinPaprika(symbols, fetchedAt) },
    { name: "Kraken", request: fetchKraken(symbols, fetchedAt) },
    { name: "Kraken OHLC", request: fetchKrakenOhlc(symbols, fetchedAt) },
    { name: "OKX", request: fetchOkx(symbols, fetchedAt) },
    { name: "KuCoin", request: fetchKuCoin(symbols, fetchedAt) },
    { name: "CoinGecko", request: fetchCoinGecko(symbols, fetchedAt) },
    { name: "Binance", request: fetchBinance(symbols, fetchedAt) },
    { name: "DefiLlama", request: fetchDefiLlama(query, fetchedAt) },
  ];
  const settled = await Promise.allSettled(jobs.map((job) => job.request));
  const sources = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const failures = settled.flatMap((result, index) => result.status === "rejected"
    ? [`${jobs[index].name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
    : []);
  if (!sources.length) {
    throw new Error(`未取得任何可核验的实时外部来源，已中止本次报告，避免使用模型旧记忆。数据源诊断：${failures.join("；")}`);
  }
  if (symbols.length && sources.filter((source) => source.kind === "market").length < 2) {
    throw new Error(`加密市场任务未取得至少两个独立实时行情来源，已中止本次报告，避免输出单一来源或过期数据。数据源诊断：${failures.join("；")}`);
  }
  return { query, fetchedAt, sources: sources.slice(0, 20) };
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
    `强制规则：涉及外部事实时在句末标注 [S编号]；无来源支持的数字或事件必须删除或明确写“未核验”；结论中必须说明数据截止时间。${longestWindow ? `当前历史序列最长只覆盖 ${longestWindow} 日，严禁声称更长的行情窗口。` : "当前没有历史序列，不得自行声称趋势窗口。"}所有 0.x 形式的价格和比率必须直接取自以上来源，不得用模型记忆补值。区间高点不得称为“历史高点/历史新高”。聚合平台的全市场成交额与单个或少数交易所成交额统计范围不同，两者差额是正常的覆盖范围差异，不能据此推断“成交量不透明”“未验证成交量占比”或流动性风险；除非来源提供同口径数据，否则不得计算交易所市场份额。`,
  ].join("\n\n");
}
