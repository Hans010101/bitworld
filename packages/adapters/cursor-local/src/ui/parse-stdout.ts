import type { TranscriptEntry } from "@paperclipai/adapter-utils";

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseAssistantMessage(messageRaw: unknown, ts: string): TranscriptEntry[] {
  if (typeof messageRaw === "string") {
    const text = messageRaw.trim();
    return text ? [{ kind: "assistant", ts, text }] : [];
  }

  const message = asRecord(messageRaw);
  if (!message) return [];

  const entries: TranscriptEntry[] = [];
  const directText = asString(message.text).trim();
  if (directText) {
    entries.push({ kind: "assistant", ts, text: directText });
  }

  const content = Array.isArray(message.content) ? message.content : [];
  for (const partRaw of content) {
    const part = asRecord(partRaw);
    if (!part) continue;
    const type = asString(part.type).trim();

    if (type === "output_text" || type === "text") {
      const text = asString(part.text).trim();
      if (text) entries.push({ kind: "assistant", ts, text });
      continue;
    }

    if (type === "thinking") {
      const text = asString(part.text).trim();
      if (text) entries.push({ kind: "thinking", ts, text });
      continue;
    }

    if (type === "tool_call") {
      entries.push({
        kind: "tool_call",
        ts,
        name: asString(part.name, asString(part.tool, "tool")),
        input: part.input ?? part.arguments ?? part.args ?? {},
      });
      continue;
    }

    if (type === "tool_result") {
      const toolUseId =
        asString(part.tool_use_id) ||
        asString(part.toolUseId) ||
        asString(part.call_id) ||
        asString(part.id) ||
        "tool_result";
      const contentText =
        asString(part.output) ||
        asString(part.text) ||
        asString(part.result) ||
        stringifyUnknown(part.output ?? part.result ?? part.text ?? part);
      const isError = part.is_error === true || asString(part.status).toLowerCase() === "error";
      entries.push({
        kind: "tool_result",
        ts,
        toolUseId,
        content: contentText,
        isError,
      });
    }
  }

  return entries;
}

export function parseCursorStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const parsed = asRecord(safeJsonParse(line));
  if (!parsed) {
    return [{ kind: "stdout", ts, text: line }];
  }

  const type = asString(parsed.type);

  if (type === "system") {
    const subtype = asString(parsed.subtype);
    if (subtype === "init") {
      const sessionId =
        asString(parsed.session_id) ||
        asString(parsed.sessionId) ||
        asString(parsed.sessionID);
      return [{ kind: "init", ts, model: asString(parsed.model, "cursor"), sessionId }];
    }
    return [{ kind: "system", ts, text: subtype ? `system: ${subtype}` : "system" }];
  }

  if (type === "assistant") {
    const entries = parseAssistantMessage(parsed.message, ts);
    return entries.length > 0 ? entries : [{ kind: "assistant", ts, text: asString(parsed.result) }];
  }

  if (type === "result") {
    const usage = asRecord(parsed.usage);
    const inputTokens = asNumber(usage?.input_tokens, asNumber(usage?.inputTokens));
    const outputTokens = asNumber(usage?.output_tokens, asNumber(usage?.outputTokens));
    const cachedTokens = asNumber(
      usage?.cached_input_tokens,
      asNumber(usage?.cachedInputTokens, asNumber(usage?.cache_read_input_tokens)),
    );
    const subtype = asString(parsed.subtype, "result");
    const errors = Array.isArray(parsed.errors)
      ? parsed.errors.map((value) => stringifyUnknown(value)).filter(Boolean)
      : [];
    const errorText = asString(parsed.error).trim();
    if (errorText) errors.push(errorText);
    const isError = parsed.is_error === true || subtype === "error" || subtype === "failed";

    return [{
      kind: "result",
      ts,
      text: asString(parsed.result),
      inputTokens,
      outputTokens,
      cachedTokens,
      costUsd: asNumber(parsed.total_cost_usd, asNumber(parsed.cost_usd, asNumber(parsed.cost))),
      subtype,
      isError,
      errors,
    }];
  }

  if (type === "error") {
    const message = asString(parsed.message) || stringifyUnknown(parsed.error ?? parsed.detail) || line;
    return [{ kind: "stderr", ts, text: message }];
  }

  // Compatibility with older stream-json event shapes.
  if (type === "step_start") {
    const sessionId = asString(parsed.sessionID);
    return [{ kind: "system", ts, text: `step started${sessionId ? ` (${sessionId})` : ""}` }];
  }

  if (type === "text") {
    const part = asRecord(parsed.part);
    const text = asString(part?.text).trim();
    if (!text) return [];
    return [{ kind: "assistant", ts, text }];
  }

  if (type === "tool_use") {
    const part = asRecord(parsed.part);
    const toolUseId = asString(part?.callID, asString(part?.id, "tool_use"));
    const toolName = asString(part?.tool, "tool");
    const state = asRecord(part?.state);
    const input = state?.input ?? {};
    const output = asString(state?.output).trim();
    const status = asString(state?.status).trim();
    const exitCode = asNumber(asRecord(state?.metadata)?.exit, NaN);
    const isError =
      status === "failed" ||
      status === "error" ||
      status === "cancelled" ||
      (Number.isFinite(exitCode) && exitCode !== 0);

    const entries: TranscriptEntry[] = [
      {
        kind: "tool_call",
        ts,
        name: toolName,
        input,
      },
    ];

    if (status || output) {
      const lines: string[] = [];
      if (status) lines.push(`status: ${status}`);
      if (Number.isFinite(exitCode)) lines.push(`exit: ${exitCode}`);
      if (output) {
        if (lines.length > 0) lines.push("");
        lines.push(output);
      }
      entries.push({
        kind: "tool_result",
        ts,
        toolUseId,
        content: lines.join("\n").trim() || "tool completed",
        isError,
      });
    }

    return entries;
  }

  if (type === "step_finish") {
    const part = asRecord(parsed.part);
    const tokens = asRecord(part?.tokens);
    const cache = asRecord(tokens?.cache);
    const reason = asString(part?.reason);
    return [{
      kind: "result",
      ts,
      text: reason,
      inputTokens: asNumber(tokens?.input),
      outputTokens: asNumber(tokens?.output),
      cachedTokens: asNumber(cache?.read),
      costUsd: asNumber(part?.cost),
      subtype: reason || "step_finish",
      isError: reason === "error" || reason === "failed",
      errors: [],
    }];
  }

  return [{ kind: "stdout", ts, text: line }];
}
