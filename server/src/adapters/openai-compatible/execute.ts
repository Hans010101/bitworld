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
  const isHqCeo = agent.name === "HQ-001-CEO";
  const isSubsidiaryCeo = !isHqCeo && /CEO/i.test(agent.name);

  let roleInstructions = "";
  if (isHqCeo) {
    roleInstructions = `\n\n## 委派机制
你是集团 CEO，可以将任务委派给子公司 Agent。
如需委派，在回复末尾输出委派指令，格式如下：

<!-- DELEGATE:{"agent":"Crypto-001-CEO","title":"任务标题","description":"详细描述"} -->
<!-- DELEGATE:{"agent":"News-001-CEO","title":"任务标题","description":"详细描述"} -->

可用 Agent 列表：
- Crypto-001-CEO：加密交易事业部，负责市场数据、交易策略、风控
- News-001-CEO：新闻雷达事业部，负责新闻采集、热点分析、简报编译
- Sentiment-001-CEO：舆情应对事业部，负责舆情监控、分析、报告
- Research-001-CEO：市场研究事业部，负责行业研究、深度报告撰写

规则：
1. 每条 DELEGATE 必须是独立一行，JSON 必须合法
2. agent 字段必须精确匹配上述 Agent 名称
3. 先输出你的任务分解分析，再输出 DELEGATE 标记
4. 如果任务简单无需委派，直接回答即可，不输出 DELEGATE`;
  } else if (isSubsidiaryCeo) {
    roleInstructions = `\n\n## 执行要求
你是子公司负责人，请直接执行分配给你的任务。
基于你的专业知识给出详细、有实质内容的分析报告。
不要委派任务，不要输出 DELEGATE 标记。
用中文回复，格式清晰，内容翔实。`;
  }

  const systemPrompt = systemPromptOverride ||
    `You are ${agent.name}, an AI agent in the Paperclip system. ` +
    `Your agent ID is ${agent.id}. ` +
    `Respond concisely and follow the instructions in the user message. ` +
    `Output your response as plain text.` +
    roleInstructions;

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
