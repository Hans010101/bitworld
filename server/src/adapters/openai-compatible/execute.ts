import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import { asString, asNumber, renderTemplate } from "../utils.js";

function joinPromptSections(sections: Array<string | null | undefined>, separator = "\n\n") {
  return sections
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join(separator);
}

function cleanAgentOutput(text: string): string {
  return text
    .replace(/<!--\s*DELEGATE:.*?-->/gs, "")
    .replace(/---session_summary---[\s\S]*?---end_summary---/g, "")
    .trim();
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
  // Phase 7 KB reuse: recent same-type report summaries injected by heartbeat.
  const kbReuseSection = asString(context.kbReuseSummaries, "").trim();

  // Build issue context section
  const issueTitle = asString(context.issueTitle, "");
  const issueDescription = asString(context.issueDescription, "");
  const issueIdentifier = asString(context.issueIdentifier, "");
  const issueSection = issueTitle
    ? `## 当前任务${issueIdentifier ? ` (${issueIdentifier})` : ""}\n\n**${issueTitle}**\n\n${issueDescription}`
    : "";
  const wakeReason = asString(context.wakeReason, "");
  const wakeSection = wakeReason ? `唤醒原因: ${wakeReason}` : "";

  // Subtask results for summarization wakeups
  const subtaskResults = asString(context.subtaskResults, "");
  const isSummarizationWake = wakeReason === "subtasks_completed" && subtaskResults.length > 0;

  let userPrompt: string;
  if (isSummarizationWake) {
    // Summarization mode: subtask results ARE the main prompt content
    userPrompt = joinPromptSections([
      "请根据以下团队成员的执行成果，汇总整理为一份完整、结构清晰的专业报告。",
      issueSection,
      kbReuseSection,
      subtaskResults,
      "请整合上述内容，去重去冗，形成完整报告，补充你的判断和建议。用中文回复。",
    ]);
  } else {
    userPrompt = joinPromptSections([
      sessionHandoffNote,
      sessionMemoryNote,
      issueSection,
      kbReuseSection,
      wakeSection,
      skillsContent,
      renderedPrompt,
    ]);
  }

  // --- 3-tier role instructions ---
  const isHqCeo = agent.name === "HQ-001-CEO";
  const isSubsidiaryCeo = !isHqCeo && /^(Crypto|News|Sentiment|Research)-001-CEO$/i.test(agent.name);

  // Team members list injected by heartbeat into context
  const teamMembers = asString(context.teamMembers, "");

  let roleInstructions = "";
  if (isSummarizationWake) {
    // Summarization mode — both HQ CEO and subsidiary CEOs
    roleInstructions = `\n\n## 汇总任务
以下是你的团队成员提交的执行成果，请汇总整理为一份完整、专业的报告。

## 汇总要求
1. 整合各成员的成果，去重去冗
2. 形成结构清晰的完整报告
3. 补充你作为负责人的判断和建议
4. 用中文回复，格式专业
5. 不要输出 DELEGATE 标记`;
  } else if (isHqCeo) {
    roleInstructions = `\n\n## 你的角色
你是 BitWorld 集团 CEO，负责接收董事长指令并统筹分派给事业部。
你不直接执行具体任务，而是分析任务性质，委派给对应事业部 CEO。

## 委派格式
在回复末尾输出委派指令（每条独立一行）：
<!-- DELEGATE:{"agent":"Crypto-001-CEO","title":"任务标题","description":"详细描述"} -->

## 可委派对象（事业部 CEO）
- Crypto-001-CEO：加密交易事业部（市场数据、交易策略、风控分析）
- News-001-CEO：新闻雷达事业部（新闻采集、分析、编译、简报）
- Sentiment-001-CEO：舆情应对事业部（舆情监控、分析、报告）
- Research-001-CEO：市场研究事业部（行业研究、深度报告）

## 规则
1. 先简要分析任务，说明委派理由
2. 可同时委派多个事业部
3. description 要足够详细，让事业部 CEO 能据此拆解子任务
4. 每条 DELEGATE 必须是独立一行，JSON 必须合法`;
  } else if (isSubsidiaryCeo) {
    const teamList = teamMembers || "（暂无团队成员信息）";
    roleInstructions = `\n\n## 你的角色
你是事业部 CEO，负责将任务拆解为具体模块并分配给团队成员执行。

## 委派格式
<!-- DELEGATE:{"agent":"成员完整名称","title":"模块标题","description":"具体执行要求"} -->

## 你的团队成员（agent 字段必须使用以下精确名称，不得修改、缩写或编造）
${teamList}

## 规则
1. 将任务拆解为 2-4 个模块，每个模块分配给最合适的团队成员
2. agent 字段必须从上方团队成员列表中精确复制，包括中文部分（如 "News-002-采集"）
3. 禁止自行编造 agent 名称，禁止合并或缩写名称
4. description 要写清楚具体执行要求、输出格式和质量标准
5. 每条 DELEGATE 必须是独立一行，JSON 必须合法`;
  } else {
    // Worker agents — direct execution
    roleInstructions = `\n\n## 你的角色
你是专业执行人员，专注于你的专业领域。
请直接执行分配给你的任务，输出详细、专业、有实质内容的成果。

## 输出要求
1. 用中文回复，格式清晰专业
2. 内容要翔实有料，不要空泛概述
3. 如需实时数据，注明"以下为基于训练数据截止日期的分析"
4. 不要委派任务，不要输出 DELEGATE 标记`;
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

  if (subtaskResults) {
    await onLog("stdout", `[openai_compatible] summarization mode: subtaskResults=${subtaskResults.length} chars\n`);
  }
  await onLog("stdout", `[openai_compatible] POST ${url} model=${model} sys=${systemPrompt.length}c user=${userPrompt.length}c\n`);
  if (isHqCeo || isSubsidiaryCeo) {
    await onLog("stdout", `[openai_compatible] role=${isHqCeo ? "hq-ceo" : "sub-ceo"} delegation=${isSummarizationWake ? "summarize" : "enabled"}\n`);
  }

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
    const rawContent = choice?.message?.content ?? "";
    const displayContent = cleanAgentOutput(rawContent);
    const finishReason = choice?.finish_reason ?? "unknown";
    const usage = json.usage;

    await onLog("stdout", displayContent);
    await onLog("stdout", `\n[openai_compatible] finish_reason=${finishReason} elapsed=${Date.now() - startTime}ms\n`);

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: displayContent.slice(0, 500),
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
        content: rawContent,
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
