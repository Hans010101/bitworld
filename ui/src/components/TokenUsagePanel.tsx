import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { CostByAgent } from "@paperclipai/shared";
import { costsApi } from "../api/costs";
import { formatTokens } from "../lib/utils";

/* ── helpers ── */

function fmtNum(n: number): string {
  return n.toLocaleString("zh-CN");
}

/* ── sub-components ── */

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-border p-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/* ── main component ── */

interface TokenUsagePanelProps {
  byAgent: CostByAgent[];
  companyId: string;
}

export function TokenUsagePanel({ byAgent, companyId }: TokenUsagePanelProps) {
  /* ── totals from byAgent ── */
  const totals = useMemo(() => {
    let input = 0;
    let output = 0;
    let cached = 0;
    let runs = 0;
    for (const a of byAgent) {
      input += a.inputTokens;
      output += a.outputTokens;
      cached += a.cachedInputTokens;
      runs += a.apiRunCount + a.subscriptionRunCount;
    }
    return { input, output, cached, runs, total: input + output + cached };
  }, [byAgent]);

  /* ── agent rows sorted by total tokens desc ── */
  const agentRows = useMemo(() => {
    return [...byAgent]
      .map((a) => ({
        ...a,
        totalTokens: a.inputTokens + a.outputTokens + a.cachedInputTokens,
        totalRuns: a.apiRunCount + a.subscriptionRunCount,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
  }, [byAgent]);

  /* ── 7-day trend: fetch byAgent for each of the last 7 days ── */
  const last7Days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dayStr = d.toISOString().slice(0, 10);
      return {
        date: dayStr,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        from: `${dayStr}T00:00:00.000Z`,
        to: `${dayStr}T23:59:59.999Z`,
      };
    });
  }, []);

  const dailyQueries = useQueries({
    queries: last7Days.map((day) => ({
      queryKey: ["daily-tokens", companyId, day.from, day.to] as const,
      queryFn: () => costsApi.byAgent(companyId, day.from, day.to),
      enabled: !!companyId,
      staleTime: 5 * 60_000,
    })),
  });

  const dailyData = useMemo(() => {
    return last7Days.map((day, i) => {
      const agents = dailyQueries[i]?.data ?? [];
      let input = 0;
      let output = 0;
      for (const a of agents) {
        input += a.inputTokens + a.cachedInputTokens;
        output += a.outputTokens;
      }
      return { ...day, input, output, total: input + output };
    });
  }, [last7Days, dailyQueries]);

  const maxDaily = Math.max(...dailyData.map((d) => d.total), 1);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Token 用量</h2>
        <p className="text-sm text-muted-foreground">所选期间的 Token 消耗统计。</p>
      </div>

      {/* ── 4 summary cards ── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="总输入 Token" value={formatTokens(totals.input)} sub={fmtNum(totals.input)} />
        <SummaryCard label="总输出 Token" value={formatTokens(totals.output)} sub={fmtNum(totals.output)} />
        <SummaryCard label="总缓存 Token" value={formatTokens(totals.cached)} sub={fmtNum(totals.cached)} />
        <SummaryCard label="总运行次数" value={fmtNum(totals.runs)} sub={`合计 ${formatTokens(totals.total)} token`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr,1fr]">
        {/* ── Agent 用量表格 ── */}
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <th className="px-4 py-2.5 text-left font-medium">Agent 名称</th>
                <th className="px-3 py-2.5 text-right font-medium">运行次数</th>
                <th className="px-3 py-2.5 text-right font-medium">输入 Token</th>
                <th className="px-3 py-2.5 text-right font-medium">输出 Token</th>
                <th className="px-3 py-2.5 text-right font-medium">缓存 Token</th>
                <th className="px-3 py-2.5 text-right font-medium">合计 Token</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {agentRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    暂无数据
                  </td>
                </tr>
              ) : (
                agentRows.map((row) => (
                  <tr key={row.agentId} className="hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{row.agentName ?? row.agentId.slice(0, 8)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(row.totalRuns)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(row.inputTokens)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(row.outputTokens)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(row.cachedInputTokens)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">{fmtNum(row.totalTokens)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── 近 7 天趋势图 ── */}
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div>
            <h3 className="text-sm font-medium">近 7 天趋势</h3>
            <span className="text-[10px] text-muted-foreground">每日 Token 消耗（输入 + 输出）</span>
          </div>
          <div className="flex items-end gap-1.5 h-36">
            {dailyData.map((day) => {
              const heightPct = (day.total / maxDaily) * 100;
              return (
                <div
                  key={day.date}
                  className="flex-1 h-full flex flex-col justify-end"
                  title={`${day.label}: 输入 ${fmtNum(day.input)} · 输出 ${fmtNum(day.output)}`}
                >
                  {day.total > 0 ? (
                    <div
                      className="flex flex-col-reverse overflow-hidden rounded-t-sm"
                      style={{ height: `${Math.max(heightPct, 2)}%` }}
                    >
                      <div className="bg-blue-500" style={{ flex: day.input }} />
                      <div className="bg-amber-500" style={{ flex: day.output }} />
                    </div>
                  ) : (
                    <div className="bg-muted/30 rounded-sm" style={{ height: 2 }} />
                  )}
                </div>
              );
            })}
          </div>
          {/* date labels */}
          <div className="flex gap-1.5">
            {dailyData.map((day) => (
              <div
                key={day.date}
                className="flex-1 text-center text-[10px] text-muted-foreground tabular-nums"
              >
                {day.label}
              </div>
            ))}
          </div>
          {/* legend */}
          <div className="flex gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              输入 Token
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              输出 Token
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
