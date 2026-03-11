import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { TranscriptEntry } from "../../adapters";
import { MarkdownBody } from "../MarkdownBody";
import { cn, formatTokens } from "../../lib/utils";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
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
  defaultOpen,
  children,
}: {
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) {
      setOpen(defaultOpen);
    }
  }, [defaultOpen, touched]);

  return (
    <div>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
        onClick={() => {
          setTouched(true);
          setOpen((current) => !current);
        }}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {open ? "Hide details" : "Show details"}
      </button>
      {open && <div className="mt-3">{children}</div>}
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
  const compact = density === "compact";

  return (
    <div>
      {!isAssistant && (
        <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <User className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          <span>User</span>
        </div>
      )}
      {compact ? (
        <div className="text-xs leading-5 text-foreground/85 whitespace-pre-wrap break-words">
          {truncate(stripMarkdown(block.text), 360)}
        </div>
      ) : (
        <MarkdownBody className="text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          {block.text}
        </MarkdownBody>
      )}
      {block.streaming && (
        <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium italic text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
          </span>
          Streaming
        </div>
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
  return (
    <div
      className={cn(
        "whitespace-pre-wrap break-words italic text-foreground/70",
        density === "compact" ? "text-[11px] leading-5" : "text-sm leading-6",
      )}
    >
      {block.text}
    </div>
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
      ? "text-cyan-700 dark:text-cyan-300"
      : block.status === "error"
        ? "text-red-700 dark:text-red-300"
        : "text-emerald-700 dark:text-emerald-300";
  const detailsClass = cn(
    "space-y-3",
    block.status === "error" && "rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3",
  );

  return (
    <div className={cn(block.status === "error" && "rounded-xl border border-red-500/20 bg-red-500/[0.04] p-3")}>
      <div className="mb-2 flex items-start gap-2">
        <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {block.name}
            </span>
            <span className={cn("text-[10px] font-semibold uppercase tracking-[0.14em]", statusTone)}>
              {statusLabel}
            </span>
            {block.toolUseId && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {truncate(block.toolUseId, compact ? 24 : 40)}
              </span>
            )}
          </div>
          <div className={cn("mt-1 break-words text-foreground/80", compact ? "text-xs" : "text-sm")}>
            {block.status === "running"
              ? summarizeToolInput(block.name, block.input, density)
              : summarizeToolResult(block.result, block.isError, density)}
          </div>
        </div>
      </div>
      <TranscriptDisclosure
        defaultOpen={block.status === "error"}
      >
        <div className={detailsClass}>
          <div className={cn("grid gap-3", compact ? "grid-cols-1" : "lg:grid-cols-2")}>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Input
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/80">
                {formatToolPayload(block.input) || "<empty>"}
              </pre>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
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
    </div>
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
      ? "rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3 text-red-700 dark:text-red-300"
      : block.tone === "warn"
        ? "text-amber-700 dark:text-amber-300"
        : block.tone === "info"
          ? "text-sky-700 dark:text-sky-300"
          : "text-foreground/75";

  return (
    <div className={toneClasses}>
      <div className="flex items-start gap-2">
        {block.tone === "error" ? (
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : block.tone === "warn" ? (
          <TerminalSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : (
          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-current/50" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {block.label}
            </span>
          </div>
          <div className={cn("mt-1 whitespace-pre-wrap break-words", compact ? "text-[11px]" : "text-xs")}>
            {block.text}
          </div>
          {block.detail && (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/75">
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
    <div className={cn("font-mono", compact ? "space-y-1 text-[11px]" : "space-y-1.5 text-xs")}>
      {entries.map((entry, idx) => (
        <div
          key={`${entry.kind}-${entry.ts}-${idx}`}
          className={cn(
            "grid gap-x-3",
            "grid-cols-[auto_1fr]",
          )}
        >
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
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
