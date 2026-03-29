import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { timeAgo } from "../lib/timeAgo";
import { cn } from "../lib/utils";
import { MarkdownBody } from "./MarkdownBody";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
import { CheckCircle2, FileText, ExternalLink, Download, Printer } from "lucide-react";
import { Link } from "@/lib/router";
import type { Agent, Issue, IssueComment } from "@paperclipai/shared";

/* ─── Agent color mapping ─── */
const AGENT_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  Luna:  { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",   dot: "bg-blue-500" },
  Marco: { bg: "bg-green-50",   text: "text-green-700",   border: "border-green-200",  dot: "bg-green-500" },
  Sage:  { bg: "bg-purple-50",  text: "text-purple-700",  border: "border-purple-200", dot: "bg-purple-500" },
  Nova:  { bg: "bg-orange-50",  text: "text-orange-700",  border: "border-orange-200", dot: "bg-orange-500" },
  Echo:  { bg: "bg-cyan-50",    text: "text-cyan-700",    border: "border-cyan-200",   dot: "bg-cyan-500" },
  Pixel: { bg: "bg-pink-50",    text: "text-pink-700",    border: "border-pink-200",   dot: "bg-pink-500" },
};
const DEFAULT_COLOR = { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200", dot: "bg-gray-500" };

/** Extract short name from "Luna — CEO" → "Luna" */
function shortName(fullName: string): string {
  const idx = fullName.indexOf("—");
  if (idx > 0) return fullName.slice(0, idx).trim();
  const idx2 = fullName.indexOf("-");
  if (idx2 > 0) return fullName.slice(0, idx2).trim();
  return fullName.trim();
}

function getAgentColor(name: string) {
  return AGENT_COLORS[shortName(name)] ?? DEFAULT_COLOR;
}

/* ─── Agent display labels ─── */
const AGENT_ROLE_LABELS: Record<string, string> = {
  Luna: "CEO",
  Marco: "CMO",
  Sage: "主编",
  Nova: "CTO",
  Echo: "分析师",
  Pixel: "创作者",
};

/* ─── Props ─── */
interface LatestResultsProps {
  issues: Issue[];
  agents: Agent[];
}

const MAX_CARDS = 12;
const SUMMARY_LENGTH = 200;

export function LatestResults({ issues, agents }: LatestResultsProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [drawerIssue, setDrawerIssue] = useState<Issue | null>(null);

  /* ── Agent map ── */
  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents) map.set(a.id, a);
    return map;
  }, [agents]);

  /* ── Filter done issues, sort by updatedAt desc ── */
  const doneIssues = useMemo(() => {
    return [...issues]
      .filter((i) => i.status === "done")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [issues]);

  /* ── Fetch comments for all done issues ── */
  const commentQueries = useQueries({
    queries: doneIssues.map((issue) => ({
      queryKey: queryKeys.issues.comments(issue.id),
      queryFn: () => issuesApi.listComments(issue.id),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const commentsMap = useMemo(() => {
    const map = new Map<string, IssueComment[]>();
    doneIssues.forEach((issue, idx) => {
      const data = commentQueries[idx]?.data;
      if (data) map.set(issue.id, data);
    });
    return map;
  }, [doneIssues, commentQueries]);

  /* ── Known agent short names for filter buttons ── */
  const agentNames = useMemo(() => {
    const names = new Set<string>();
    for (const issue of doneIssues) {
      if (issue.assigneeAgentId) {
        const agent = agentMap.get(issue.assigneeAgentId);
        if (agent) names.add(shortName(agent.name));
      }
    }
    // Return in canonical order
    return ["Luna", "Marco", "Sage", "Nova", "Echo", "Pixel"].filter((n) => names.has(n));
  }, [doneIssues, agentMap]);

  /* ── Apply agent filter ── */
  const filteredIssues = useMemo(() => {
    if (!selectedAgent) return doneIssues;
    return doneIssues.filter((issue) => {
      if (!issue.assigneeAgentId) return false;
      const agent = agentMap.get(issue.assigneeAgentId);
      return agent ? shortName(agent.name) === selectedAgent : false;
    });
  }, [doneIssues, selectedAgent, agentMap]);

  const displayIssues = filteredIssues.slice(0, MAX_CARDS);
  const hasMore = filteredIssues.length > MAX_CARDS;

  /* ── Get latest comment summary for an issue ── */
  function getCommentSummary(issueId: string): string {
    const comments = commentsMap.get(issueId);
    if (!comments || comments.length === 0) return "暂无成果摘要";
    const latest = comments[comments.length - 1];
    const text = latest.body.replace(/[#*_`~\[\]()>|\\-]/g, "").replace(/\n+/g, " ").trim();
    if (text.length <= SUMMARY_LENGTH) return text;
    return text.slice(0, SUMMARY_LENGTH) + "...";
  }

  /* ── Drawer comments ── */
  const drawerComments = drawerIssue ? commentsMap.get(drawerIssue.id) ?? [] : [];
  const drawerAgent = drawerIssue?.assigneeAgentId ? agentMap.get(drawerIssue.assigneeAgentId) : null;

  /* ── Download helpers ── */
  function downloadMarkdown() {
    if (!drawerIssue || drawerComments.length === 0) return;
    const content = drawerComments.map((c) => c.body).join("\n\n---\n\n");
    const identifier = drawerIssue.identifier ?? "issue";
    const title = drawerIssue.title.replace(/[\\/:*?"<>|]/g, "_");
    const filename = `${identifier}_${title}.md`;
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPDF() {
    if (!drawerIssue || drawerComments.length === 0) return;
    const identifier = drawerIssue.identifier ?? "issue";
    const title = drawerIssue.title;
    // Build a standalone HTML document for printing
    const content = drawerComments.map((c) => c.body).join("\n\n---\n\n");
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${identifier} ${title}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:800px;margin:0 auto;padding:2rem;font-size:14px;line-height:1.6;color:#1a1a1a}
h1{font-size:1.5rem;border-bottom:1px solid #e5e7eb;padding-bottom:.5rem}
h2{font-size:1.25rem;margin-top:1.5rem}
h3{font-size:1.1rem;margin-top:1rem}
table{border-collapse:collapse;width:100%;margin:1rem 0}
th,td{border:1px solid #d1d5db;padding:6px 10px;text-align:left;font-size:13px}
th{background:#f3f4f6;font-weight:600}
code{background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:12px}
pre{background:#f3f4f6;padding:12px;border-radius:6px;overflow-x:auto;font-size:12px}
hr{border:none;border-top:1px solid #e5e7eb;margin:1.5rem 0}
blockquote{border-left:3px solid #d1d5db;margin:1rem 0;padding:0.5rem 1rem;color:#4b5563}
@media print{body{padding:0}}
</style>
</head><body id="content"></body></html>`);
    printWindow.document.close();
    // Use a simple markdown-to-HTML conversion for printing
    const el = printWindow.document.getElementById("content");
    if (el) {
      // Basic markdown rendering: convert headings, bold, tables, lists, hr, blockquotes
      let html = content
        .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        .replace(/^## (.+)$/gm, "<h2>$1</h2>")
        .replace(/^# (.+)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/^---$/gm, "<hr>")
        .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");
      // Convert table blocks
      html = html.replace(/((?:^\|.+\|$\n?)+)/gm, (tableBlock) => {
        const rows = tableBlock.trim().split("\n").filter((r) => !r.match(/^\|[\s:-]+\|$/));
        if (rows.length === 0) return tableBlock;
        let table = "<table>";
        rows.forEach((row, i) => {
          const cells = row.split("|").filter((c) => c.trim() !== "");
          const tag = i === 0 ? "th" : "td";
          table += "<tr>" + cells.map((c) => `<${tag}>${c.trim()}</${tag}>`).join("") + "</tr>";
        });
        table += "</table>";
        return table;
      });
      // Convert remaining newlines to paragraphs
      html = html
        .split("\n\n")
        .map((p) => (p.startsWith("<") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`))
        .join("\n");
      el.innerHTML = html;
    }
    setTimeout(() => { printWindow.print(); }, 300);
  }

  if (doneIssues.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* ── Section header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <h3 className="text-base font-semibold">最新成果</h3>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            {doneIssues.length} 项已完成
          </span>
        </div>
        <Link
          to="/issues"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors no-underline"
        >
          查看全部事项 →
        </Link>
      </div>

      {/* ── Filter buttons ── */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedAgent(null)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors border",
            !selectedAgent
              ? "bg-foreground text-background border-foreground"
              : "bg-background text-muted-foreground border-border hover:bg-accent"
          )}
        >
          全部
        </button>
        {agentNames.map((name) => {
          const color = getAgentColor(name);
          const isActive = selectedAgent === name;
          return (
            <button
              key={name}
              onClick={() => setSelectedAgent(isActive ? null : name)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors border",
                isActive
                  ? `${color.bg} ${color.text} ${color.border}`
                  : "bg-background text-muted-foreground border-border hover:bg-accent"
              )}
            >
              <span className={cn("inline-block w-1.5 h-1.5 rounded-full mr-1.5", color.dot)} />
              {name}
              {AGENT_ROLE_LABELS[name] ? ` (${AGENT_ROLE_LABELS[name]})` : ""}
            </button>
          );
        })}
      </div>

      {/* ── Card grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {displayIssues.map((issue) => {
          const agent = issue.assigneeAgentId ? agentMap.get(issue.assigneeAgentId) : null;
          const color = agent ? getAgentColor(agent.name) : DEFAULT_COLOR;
          const summary = getCommentSummary(issue.id);

          return (
            <div
              key={issue.id}
              className="group flex flex-col rounded-lg border border-border bg-card p-4 hover:shadow-md transition-shadow"
            >
              {/* Top row: identifier + agent badge */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-muted-foreground">
                  {issue.identifier ?? issue.id.slice(0, 8)}
                </span>
                {agent && (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border",
                      color.bg,
                      color.text,
                      color.border
                    )}
                  >
                    <span className={cn("inline-block w-1.5 h-1.5 rounded-full mr-1", color.dot)} />
                    {shortName(agent.name)}
                  </span>
                )}
              </div>

              {/* Title */}
              <h4 className="text-sm font-medium leading-snug line-clamp-2 mb-2">
                {issue.title}
              </h4>

              {/* Time */}
              <p className="text-xs text-muted-foreground mb-3">
                完成于 {timeAgo(issue.updatedAt)}
              </p>

              {/* Summary */}
              <p className="text-xs text-muted-foreground leading-relaxed flex-1 mb-3 line-clamp-4">
                {summary}
              </p>

              {/* Action button */}
              <button
                onClick={() => setDrawerIssue(issue)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors self-start"
              >
                <FileText className="h-3.5 w-3.5" />
                查看完整内容
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Show more link ── */}
      {hasMore && (
        <div className="text-center">
          <Link
            to="/issues"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors no-underline"
          >
            查看全部 {filteredIssues.length} 项已完成事项
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* ── Detail drawer ── */}
      <Sheet open={!!drawerIssue} onOpenChange={(open) => !open && setDrawerIssue(null)}>
        <SheetContent
          side="right"
          className="w-[60vw] sm:max-w-[60vw] flex flex-col overflow-hidden"
        >
          {drawerIssue && (
            <>
              <SheetHeader className="border-b pb-4 shrink-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-muted-foreground">
                    {drawerIssue.identifier}
                  </span>
                  {drawerAgent && (() => {
                    const sn = shortName(drawerAgent.name);
                    const c = getAgentColor(drawerAgent.name);
                    return (
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border",
                          c.bg, c.text, c.border
                        )}
                      >
                        {sn}
                        {AGENT_ROLE_LABELS[sn] ? ` (${AGENT_ROLE_LABELS[sn]})` : ""}
                      </span>
                    );
                  })()}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <SheetTitle className="text-lg">{drawerIssue.title}</SheetTitle>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={downloadMarkdown}
                      disabled={drawerComments.length === 0}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <Download className="h-3.5 w-3.5" />
                      下载 MD
                    </button>
                    <button
                      onClick={downloadPDF}
                      disabled={drawerComments.length === 0}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      下载 PDF
                    </button>
                  </div>
                </div>
                <SheetDescription>
                  完成于 {timeAgo(drawerIssue.updatedAt)}
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto scroll-smooth px-4 pb-6 space-y-6">
                {drawerComments.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    暂无评论内容
                  </p>
                ) : (
                  drawerComments.map((comment) => {
                    const commentAgent = comment.authorAgentId
                      ? agentMap.get(comment.authorAgentId)
                      : null;
                    return (
                      <div key={comment.id} className="space-y-2">
                        {commentAgent && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {commentAgent.name}
                            </span>
                            <span>{timeAgo(comment.createdAt)}</span>
                          </div>
                        )}
                        <div
                          className={cn(
                            "prose prose-sm max-w-none",
                            // Heading enhancements
                            "prose-headings:font-semibold prose-headings:text-foreground",
                            "prose-h1:text-xl prose-h1:border-b prose-h1:border-border prose-h1:pb-2 prose-h1:mb-4",
                            "prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3",
                            "prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2",
                            "prose-h4:text-sm prose-h4:mt-3 prose-h4:mb-1",
                            // Table enhancements
                            "prose-table:border-collapse prose-table:w-full prose-table:text-sm",
                            "prose-th:bg-muted/50 prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-1.5 prose-th:text-left prose-th:font-medium",
                            "prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-1.5",
                            // Code block enhancements
                            "prose-pre:bg-muted/60 prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:text-xs",
                            "prose-code:bg-muted/60 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono",
                            // List enhancements
                            "prose-ul:pl-5 prose-ol:pl-5",
                            "prose-li:my-0.5",
                            // HR
                            "prose-hr:border-border prose-hr:my-4",
                            // Links
                            "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
                          )}
                        >
                          <MarkdownBody>{comment.body}</MarkdownBody>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
