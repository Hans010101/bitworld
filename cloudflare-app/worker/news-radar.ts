export type RadarCandidate = {
  title: string;
  publisher: string;
  url: string;
  publishedAt: string | null;
  snippet: string;
};

export type RadarScore = {
  index: number;
  score: number;
  reason: string;
};

export function radarFingerprint(title: string): string {
  return title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 180);
}

export function parseRadarScores(output: string, candidateCount: number): RadarScore[] {
  const json = output.match(/\[[\s\S]*\]/)?.[0];
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<number>();
    return parsed.flatMap((item): RadarScore[] => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      const index = Math.trunc(Number(row.index));
      const score = Math.trunc(Number(row.score));
      if (index < 1 || index > candidateCount || score < 1 || score > 10 || seen.has(index)) return [];
      seen.add(index);
      return [{ index, score, reason: typeof row.reason === "string" ? row.reason.trim().slice(0, 240) : "" }];
    });
  } catch {
    return [];
  }
}

export function fallbackRadarScores(candidates: RadarCandidate[]): RadarScore[] {
  return candidates.map((candidate, index) => {
    const official = /Federal Reserve|SEC|Bureau of Labor Statistics|美联储|美国证券交易委员会|美国劳工统计局/i
      .test(candidate.publisher);
    const consequential = /央行|利率|通胀|就业|监管|制裁|并购|财报|bank|rate|inflation|employment|regulat|sanction|acqui|earnings/i
      .test(`${candidate.title} ${candidate.snippet}`);
    return {
      index: index + 1,
      score: official ? 9 : consequential ? 8 : 7,
      reason: official ? "权威一手来源，且可能影响市场预期或经营判断" : consequential ? "事件具有明确的市场或经营影响" : "与当日财经决策相关",
    };
  });
}

export function selectRadarScores(
  scores: RadarScore[],
  threshold: number,
  maxItems: number,
  minimumItems = 5,
): RadarScore[] {
  const ordered = [...scores].sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = ordered.filter((item) => item.score >= threshold).slice(0, maxItems);
  if (selected.length >= Math.min(minimumItems, ordered.length)) return selected;
  return ordered.slice(0, Math.min(maxItems, Math.max(minimumItems, selected.length)));
}
