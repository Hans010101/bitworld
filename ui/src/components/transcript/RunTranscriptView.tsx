import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { TranscriptEntry } from "../../adapters";
import { MarkdownBody } from "../MarkdownBody";
import { cn, formatTokens, relativeTime } from "../../lib/utils";
import {
  Bot,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Info,
  TerminalSquare,
  User,
  Wrench,
} from "lucide-react";

export type TranscriptMode = "nice" | "raw";
export type TranscriptDensity = "comfortable" | "compact";

interface RunTranscriptViewProps {
  entries: TranscriptEntry[];
  mode?: TranscriptMode;
  density?: TranscriptDensity;
  limit?: number;
  streaming?: boolean;
  emptyMessage?: string;
  className?: string;
}

type TranscriptBlock =
  | {
      type: "message";
      role: "assistant" | "user";
      ts: string;
      text: string;
      streaming: boolean;
    }
  | {
      type: "thinking";
      ts: string;
      text: string;
      streaming: boolean;
    }
  | {
      type: "tool";
      ts: string;
      endTs?: string;
      name: string;
      toolUseId?: string;
      input: unknown;
      result?: string;
      isError?: boolean;
      status: "running" | "completed" | "error";
    }
  | {
      type: "event";
      ts: string;
      label: string;
      tone: "info" | "warn" | "error" | "neutral";
      text: string;
      detail?: string;
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

function stripMarkdown(value: string): string {
  return compactWhitespace(
    value
      .replace(/```[\s\S]*?```/g, " code ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_#>-]/g, " "),
  );
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleTimeString("en-US", { hour12: false });
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatToolPayload(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return formatUnknown(value);
}

function extractToolUseId(input: unknown): string | undefined {
  const record = asRecord(input);
  if (!record) return undefined;
  const candidates = [
    record.toolUseId,
    record.tool_use_id,
    record.callId,
    record.call_id,
    record.id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return undefined;
}

function summarizeRecord(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return truncate(compactWhitespace(value), 120);
    }
  }
  return null;
}

function summarizeToolInput(name: string, input: unknown, density: TranscriptDensity): string {
  const compactMax = density === "compact" ? 72 : 120;
  if (typeof input === "string") return truncate(compactWhitespace(input), compactMax);
  const record = asRecord(input);
  if (!record) {
    const serialized = compactWhitespace(formatUnknown(input));
    return serialized ? truncate(serialized, compactMax) : `Inspect ${name} input`;
  }

  const direct =
    summarizeRecord(record, ["command", "cmd", "path", "filePath", "file_path", "query", "url", "prompt", "message"])
    ?? summarizeRecord(record, ["pattern", "name", "title", "target", "tool"])
    ?? null;
  if (direct) return truncate(direct, compactMax);

  if (Array.isArray(record.paths) && record.paths.length > 0) {
    const first = record.paths.find((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (first) {
      return truncate(`${record.paths.length} paths, starting with ${first}`, compactMax);
    }
  }

  const keys = Object.keys(record);
  if (keys.length === 0) return `No ${name} input`;
  if (keys.length === 1) return truncate(`${keys[0]} payload`, compactMax);
  return truncate(`${keys.length} fields: ${keys.slice(0, 3).join(", ")}`, compactMax);
}

function summarizeToolResult(result: string | undefined, isError: boolean | undefined, density: TranscriptDensity): string {
  if (!result) return isError ? "Tool failed" : "Waiting for result";
  const lines = result
    .split(/\r?\n/)
    .map((line) => compactWhitespace(line))
    .filter(Boolean);
  const firstLine = lines[0] ?? result;
  return truncate(firstLine, density === "compact" ? 84 : 140);
}

function normalizeTranscript(entries: TranscriptEntry[], streaming: boolean): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  const pendingToolBlocks = new Map<string, Extract<TranscriptBlock, { type: "tool" }>>();

  for (const entry of entries) {
    const previous = blocks[blocks.length - 1];

    if (entry.kind === "assistant" || entry.kind === "user") {
      const isStreaming = streaming && entry.kind === "assistant" && entry.delta === true;
      if (previous?.type === "message" && previous.role === entry.kind) {
        previous.text += previous.text.endsWith("\n") || entry.text.startsWith("\n") ? entry.text : `\n${entry.text}`;
        previous.ts = entry.ts;
        previous.streaming = previous.streaming || isStreaming;
      } else {
        blocks.push({
          type: "message",
          role: entry.kind,
          ts: entry.ts,
          text: entry.text,
          streaming: isStreaming,
        });
      }
      continue;
    }

    if (entry.kind === "thinking") {
      const isStreaming = streaming && entry.delta === true;
      if (previous?.type === "thinking") {
        previous.text += previous.text.endsWith("\n") || entry.text.startsWith("\n") ? entry.text : `\n${entry.text}`;
        previous.ts = entry.ts;
        previous.streaming = previous.streaming || isStreaming;
      } else {
        blocks.push({
          type: "thinking",
          ts: entry.ts,
          text: entry.text,
          streaming: isStreaming,
        });
      }
      continue;
    }

    if (entry.kind === "tool_call") {
      const toolBlock: Extract<TranscriptBlock, { type: "tool" }> = {
        type: "tool",
        ts: entry.ts,
        name: entry.name,
        toolUseId: entry.toolUseId ?? extractToolUseId(entry.input),
        input: entry.input,
        status: "running",
      };
      blocks.push(toolBlock);
      if (toolBlock.toolUseId) {
        pendingToolBlocks.set(toolBlock.toolUseId, toolBlock);
      }
      continue;
    }

    if (entry.kind === "tool_result") {
      const matched =
        pendingToolBlocks.get(entry.toolUseId)
        ?? [...blocks].reverse().find((block): block is Extract<TranscriptBlock, { type: "tool" }> => block.type === "tool" && block.status === "running");

      if (matched) {
        matched.result = entry.content;
        matched.isError = entry.isError;
        matched.status = entry.isError ? "error" : "completed";
        matched.endTs = entry.ts;
        pendingToolBlocks.delete(entry.toolUseId);
      } else {
        blocks.push({
          type: "tool",
          ts: entry.ts,
          endTs: entry.ts,
          name: "tool",
          toolUseId: entry.toolUseId,
          input: null,
          result: entry.content,
          isError: entry.isError,
          status: entry.isError ? "error" : "completed",
        });
      }
      continue;
    }

    if (entry.kind === "init") {
      blocks.push({
        type: "event",
        ts: entry.ts,
        label: "init",
        tone: "info",
        text: `Model ${entry.model}${entry.sessionId ? ` • session ${entry.sessionId}` : ""}`,
      });
      continue;
    }

    if (entry.kind === "result") {
      const summary = `tokens in ${formatTokens(entry.inputTokens)} • out ${formatTokens(entry.outputTokens)} • cached ${formatTokens(entry.cachedTokens)} • $${entry.costUsd.toFixed(6)}`;
      const detailParts = [
        entry.text.trim(),
        entry.subtype ? `subtype=${entry.subtype}` : "",
        entry.errors.length > 0 ? `errors=${entry.errors.join(" | ")}` : "",
      ].filter(Boolean);
      blocks.push({
        type: "event",
        ts: entry.ts,
        label: "result",
        tone: entry.isError ? "error" : "info",
        text: summary,
        detail: detailParts.join("\n\n") || undefined,
      });
      continue;
    }

    if (entry.kind === "stderr") {
      blocks.push({
        type: "event",
        ts: entry.ts,
        label: "stderr",
        tone: "error",
        text: entry.text,
      });
      continue;
    }

    if (entry.kind === "system") {
      blocks.push({
        type: "event",
        ts: entry.ts,
        label: "system",
        tone: "warn",
        text: entry.text,
      });
      continue;
    }

    blocks.push({
      type: "event",
      ts: entry.ts,
      label: "stdout",
      tone: "neutral",
      text: entry.text,
    });
  }

  return blocks;
}

function TranscriptDisclosure({
  icon,
  label,
  tone,
  summary,
  timestamp,
  defaultOpen,
  compact,
  children,
}: {
  icon: typeof BrainCircuit;
  label: string;
  tone: "thinking" | "tool";
  summary: string;
  timestamp: string;
  defaultOpen: boolean;
  compact: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) {
      setOpen(defaultOpen);
    }
  }, [defaultOpen, touched]);

  const Icon = icon;
  const borderTone =
    tone === "thinking"
      ? "border-amber-500/25 bg-amber-500/[0.07]"
      : "border-cyan-500/25 bg-cyan-500/[0.07]";
  const iconTone =
    tone === "thinking"
      ? "text-amber-700 dark:text-amber-300"
      : "text-cyan-700 dark:text-cyan-300";

  return (
    <div className={cn("rounded-2xl border shadow-sm", borderTone, compact ? "p-2.5" : "p-3.5")}>
      <button
        type="button"
        className="flex w-full items-start gap-3 text-left"
        onClick={() => {
          setTouched(true);
          setOpen((current) => !current);
        }}
      >
        <span className={cn("mt-0.5 inline-flex rounded-full border border-current/15 p-1", iconTone)}>
          <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {label}
            </span>
            <span className="text-[10px] text-muted-foreground">{timestamp}</span>
          </span>
          <span className={cn("mt-1 block min-w-0 break-words text-foreground/80", compact ? "text-xs" : "text-sm")}>
            {summary}
          </span>
        </span>
        {open ? <ChevronDown className="mt-1 h-4 w-4 text-muted-foreground" /> : <ChevronRight className="mt-1 h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <div className={compact ? "mt-2.5" : "mt-3"}>{children}</div>}
    </div>
  );
}

function TranscriptMessageBlock({
  block,
  density,
}: {
  block: Extract<TranscriptBlock, { type: "message" }>;
  density: TranscriptDensity;
}) {
  const isAssistant = block.role === "assistant";
  const Icon = isAssistant ? Bot : User;
  const panelTone = isAssistant
    ? "border-emerald-500/25 bg-emerald-500/[0.08]"
    : "border-violet-500/20 bg-violet-500/[0.07]";
  const iconTone = isAssistant
    ? "text-emerald-700 dark:text-emerald-300"
    : "text-violet-700 dark:text-violet-300";
  const compact = density === "compact";

  return (
    <div className={cn("rounded-2xl border shadow-sm", panelTone, compact ? "p-2.5" : "p-4")}>
      <div className="mb-2 flex items-center gap-2">
        <span className={cn("inline-flex rounded-full border border-current/15 p-1", iconTone)}>
          <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {isAssistant ? "Assistant" : "User"}
        </span>
        <span className="text-[10px] text-muted-foreground">{formatTimestamp(block.ts)}</span>
        {block.streaming && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
            Streaming
          </span>
        )}
      </div>
      {compact ? (
        <div className="text-xs leading-5 text-foreground/85 whitespace-pre-wrap break-words">
          {truncate(stripMarkdown(block.text), 360)}
        </div>
      ) : (
        <MarkdownBody className="text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          {block.text}
        </MarkdownBody>
      )}
    </div>
  );
}

function TranscriptThinkingBlock({
  block,
  density,
}: {
  block: Extract<TranscriptBlock, { type: "thinking" }>;
  density: TranscriptDensity;
}) {
  const compact = density === "compact";
  return (
    <TranscriptDisclosure
      icon={BrainCircuit}
      label="Thinking"
      tone="thinking"
      summary={truncate(stripMarkdown(block.text), compact ? 120 : 220)}
      timestamp={formatTimestamp(block.ts)}
      defaultOpen={block.streaming}
      compact={compact}
    >
      <div className={cn("rounded-xl border border-amber-500/15 bg-background/70 text-foreground/75 whitespace-pre-wrap break-words", compact ? "p-2 text-[11px]" : "p-3 text-sm")}>
        {block.text}
      </div>
    </TranscriptDisclosure>
  );
}

function TranscriptToolCard({
  block,
  density,
}: {
  block: Extract<TranscriptBlock, { type: "tool" }>;
  density: TranscriptDensity;
}) {
  const compact = density === "compact";
  const statusLabel =
    block.status === "running"
      ? "Running"
      : block.status === "error"
        ? "Errored"
        : "Completed";
  const statusTone =
    block.status === "running"
      ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
      : block.status === "error"
        ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
        : "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";

  return (
    <TranscriptDisclosure
      icon={Wrench}
      label={block.name}
      tone="tool"
      summary={block.status === "running"
        ? summarizeToolInput(block.name, block.input, density)
        : summarizeToolResult(block.result, block.isError, density)}
      timestamp={formatTimestamp(block.endTs ?? block.ts)}
      defaultOpen={block.status === "error"}
      compact={compact}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]", statusTone)}>
            {statusLabel}
          </span>
          {block.toolUseId && (
            <span className="rounded-full border border-border/70 bg-background/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              {truncate(block.toolUseId, compact ? 24 : 40)}
            </span>
          )}
        </div>
        <div className={cn("grid gap-2", compact ? "grid-cols-1" : "lg:grid-cols-2")}>
          <div className="rounded-xl border border-border/70 bg-background/80 p-2.5">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Input
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/80">
              {formatToolPayload(block.input) || "<empty>"}
            </pre>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/80 p-2.5">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Result
            </div>
            <pre className={cn(
              "overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px]",
              block.status === "error" ? "text-red-700 dark:text-red-300" : "text-foreground/80",
            )}>
              {block.result ? formatToolPayload(block.result) : "Waiting for result..."}
            </pre>
          </div>
        </div>
      </div>
    </TranscriptDisclosure>
  );
}

function TranscriptEventRow({
  block,
  density,
}: {
  block: Extract<TranscriptBlock, { type: "event" }>;
  density: TranscriptDensity;
}) {
  const compact = density === "compact";
  const toneClasses =
    block.tone === "error"
      ? "border-red-500/20 bg-red-500/[0.06] text-red-700 dark:text-red-300"
      : block.tone === "warn"
        ? "border-amber-500/20 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300"
        : block.tone === "info"
          ? "border-sky-500/20 bg-sky-500/[0.06] text-sky-700 dark:text-sky-300"
          : "border-border/70 bg-background/70 text-foreground/75";

  return (
    <div className={cn("rounded-xl border", toneClasses, compact ? "p-2" : "p-2.5")}>
      <div className="flex items-start gap-2">
        {block.tone === "error" ? (
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : block.tone === "warn" ? (
          <TerminalSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : (
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {block.label}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {compact ? relativeTime(block.ts) : formatTimestamp(block.ts)}
            </span>
          </div>
          <div className={cn("mt-1 whitespace-pre-wrap break-words", compact ? "text-[11px]" : "text-xs")}>
            {block.text}
          </div>
          {block.detail && (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-background/70 p-2 font-mono text-[11px] text-foreground/75">
              {block.detail}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function RawTranscriptView({
  entries,
  density,
}: {
  entries: TranscriptEntry[];
  density: TranscriptDensity;
}) {
  const compact = density === "compact";
  return (
    <div className={cn(
      "rounded-2xl border border-border/70 bg-neutral-100/70 p-3 font-mono shadow-inner dark:bg-neutral-950/60",
      compact ? "space-y-1 text-[11px]" : "space-y-1.5 text-xs",
    )}>
      {entries.map((entry, idx) => (
        <div
          key={`${entry.kind}-${entry.ts}-${idx}`}
          className={cn(
            "grid gap-x-3",
            compact ? "grid-cols-[auto_1fr]" : "grid-cols-[auto_auto_1fr]",
          )}
        >
          <span className="text-[10px] text-muted-foreground">{formatTimestamp(entry.ts)}</span>
          <span className={cn(
            "text-[10px] uppercase tracking-[0.18em] text-muted-foreground",
            compact && "hidden",
          )}>
            {entry.kind}
          </span>
          <pre className="min-w-0 whitespace-pre-wrap break-words text-foreground/80">
            {entry.kind === "tool_call"
              ? `${entry.name}\n${formatToolPayload(entry.input)}`
              : entry.kind === "tool_result"
                ? formatToolPayload(entry.content)
                : entry.kind === "result"
                  ? `${entry.text}\n${formatTokens(entry.inputTokens)} / ${formatTokens(entry.outputTokens)} / $${entry.costUsd.toFixed(6)}`
                  : entry.kind === "init"
                    ? `model=${entry.model}${entry.sessionId ? ` session=${entry.sessionId}` : ""}`
                    : entry.text}
          </pre>
        </div>
      ))}
    </div>
  );
}

export function RunTranscriptView({
  entries,
  mode = "nice",
  density = "comfortable",
  limit,
  streaming = false,
  emptyMessage = "No transcript yet.",
  className,
}: RunTranscriptViewProps) {
  const blocks = useMemo(() => normalizeTranscript(entries, streaming), [entries, streaming]);
  const visibleBlocks = limit ? blocks.slice(-limit) : blocks;
  const visibleEntries = limit ? entries.slice(-limit) : entries;

  if (entries.length === 0) {
    return (
      <div className={cn("rounded-2xl border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground", className)}>
        {emptyMessage}
      </div>
    );
  }

  if (mode === "raw") {
    return (
      <div className={className}>
        <RawTranscriptView entries={visibleEntries} density={density} />
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {visibleBlocks.map((block, index) => (
        <div
          key={`${block.type}-${block.ts}-${index}`}
          className={cn(index === visibleBlocks.length - 1 && streaming && "animate-in fade-in slide-in-from-bottom-1 duration-300")}
        >
          {block.type === "message" && <TranscriptMessageBlock block={block} density={density} />}
          {block.type === "thinking" && <TranscriptThinkingBlock block={block} density={density} />}
          {block.type === "tool" && <TranscriptToolCard block={block} density={density} />}
          {block.type === "event" && <TranscriptEventRow block={block} density={density} />}
        </div>
      ))}
    </div>
  );
}
