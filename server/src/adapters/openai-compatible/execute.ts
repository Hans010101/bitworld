import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import { asString, asNumber, renderTemplate } from "../utils.js";

function joinPromptSections(sections: Array<string | null | undefined>, separator = "\n\n") {
  return sections
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join(separator);
}

/**
 * OpenAI-compatible chat completions adapter.
 *
 * Calls any API that implements POST /chat/completions in the OpenAI format.
 * Primary target: Alibaba Cloud DashScope (百炼) for DeepSeek and Qwen models.
 *
 * Required config (via adapterConfig or model-router override):
 *   baseUrl  — API base URL (e.g. https://dashscope.aliyuncs.com/compatible-mode/v1)
 *   apiKey   — Bearer token
 *   model    — Model identifier (e.g. deepseek-v3, qwen3-max, deepseek-r1)
 *
 * Optional config:
 *   temperature, maxTokens, timeoutSec, systemPrompt
 */
export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, onLog } = ctx;

  const baseUrl = asString(config.baseUrl, "");
  const apiKey = asString(config.apiKey, "");
  const model = asString(config.model, "");

  if (!baseUrl) throw new Error("openai_compatible adapter: missing baseUrl");
  if (!apiKey) throw new Error("openai_compatible adapter: missing apiKey");
  if (!model) throw new Error("openai_compatible adapter: missing model");

  const temperature = asNumber(config.temperature, 0.7);
  const maxTokens = asNumber(config.maxTokens, 4096);
  const timeoutSec = asNumber(config.timeoutSec, 300);
  const systemPromptOverride = asString(config.systemPrompt, "");

  // Build prompt from context — same sections as claude-local adapter
  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  );
  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  };
  const renderedPrompt = renderTemplate(promptTemplate, templateData);

  const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
  const sessionMemoryNote = asString(context.paperclipSessionMemory, "").trim();
  const skillsContent = asString(context.paperclipSkillsContent, "").trim();

  // Build issue context section — critical for API-only adapters that can't fetch issues themselves
  const issueTitle = asString(context.issueTitle, "");
  const issueDescription = asString(context.issueDescription, "");
  const issueIdentifier = asString(context.issueIdentifier, "");
  const issueSection = issueTitle
    ? `## 当前任务${issueIdentifier ? ` (${issueIdentifier})` : ""}\n\n**${issueTitle}**\n\n${issueDescription}`
    : "";
  const wakeReason = asString(context.wakeReason, "");
  const wakeSection = wakeReason ? `唤醒原因: ${wakeReason}` : "";

  const userPrompt = joinPromptSections([
    sessionHandoffNote,
    sessionMemoryNote,
    issueSection,
    wakeSection,
    skillsContent,
    renderedPrompt,
  ]);

  // Build system prompt
  const systemPrompt = systemPromptOverride ||
    `You are ${agent.name}, an AI agent in the Paperclip system. ` +
    `Your agent ID is ${agent.id}. ` +
    `Respond concisely and follow the instructions in the user message. ` +
    `Output your response as plain text.`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const requestBody = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  await onLog("stdout", `[openai_compatible] POST ${url} model=${model}\n`);

  const controller = new AbortController();
  const timer = timeoutSec > 0
    ? setTimeout(() => controller.abort(), timeoutSec * 1000)
    : null;

  const startTime = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      const errorMsg = `OpenAI-compatible API returned ${res.status}: ${errorBody.slice(0, 500)}`;
      await onLog("stderr", `[openai_compatible] ${errorMsg}\n`);
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage: errorMsg,
        summary: `API error ${res.status}`,
      };
    }

    const json = await res.json() as {
      id?: string;
      choices?: Array<{
        message?: { content?: string; role?: string };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
      model?: string;
    };

    const choice = json.choices?.[0];
    const content = choice?.message?.content ?? "";
    const finishReason = choice?.finish_reason ?? "unknown";
    const usage = json.usage;

    await onLog("stdout", content);
    await onLog("stdout", `\n[openai_compatible] finish_reason=${finishReason} elapsed=${Date.now() - startTime}ms\n`);

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: content.slice(0, 500),
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
            cachedInputTokens: 0,
          }
        : undefined,
      provider: "openai_compatible",
      model: json.model ?? model,
      resultJson: {
        content,
        finishReason,
        apiResponseId: json.id,
      },
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const errorMsg = isTimeout
      ? `Request timed out after ${timeoutSec}s`
      : err instanceof Error ? err.message : String(err);
    await onLog("stderr", `[openai_compatible] ${errorMsg}\n`);
    return {
      exitCode: 1,
      signal: null,
      timedOut: isTimeout,
      errorMessage: errorMsg,
      summary: isTimeout ? "Timed out" : "Request failed",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
