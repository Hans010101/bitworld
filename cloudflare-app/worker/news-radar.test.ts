import {
  fallbackRadarScores,
  parseRadarScores,
  radarFingerprint,
  selectRadarScores,
  type RadarCandidate,
} from "./news-radar.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const candidates: RadarCandidate[] = [
  { title: "Fed keeps rates unchanged", publisher: "Federal Reserve", url: "https://example.com/1", publishedAt: null, snippet: "" },
  { title: "Company launches a product", publisher: "Example", url: "https://example.com/2", publishedAt: null, snippet: "" },
];

assert(radarFingerprint("Ｆｅｄ：Rates! ") === "fedrates", "标题指纹应统一全角、大小写和标点");
const parsed = parseRadarScores("```json\n[{\"index\":2,\"score\":8,\"reason\":\"重要\"},{\"index\":9,\"score\":10}]\n```", 2);
assert(parsed.length === 1 && parsed[0].index === 2 && parsed[0].reason === "重要", "评分解析应丢弃越界项");
assert(fallbackRadarScores(candidates)[0].score === 9, "权威来源回退评分应保持高优先级");
assert(selectRadarScores([{ index: 1, score: 9, reason: "" }, { index: 2, score: 6, reason: "" }], 7, 10, 2).length === 2, "条目不足时应补足当日精选");

console.log("news-radar self-check passed");
