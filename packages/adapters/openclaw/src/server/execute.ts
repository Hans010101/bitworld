import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { asNumber, asString, parseObject } from "@paperclipai/adapter-utils/server-utils";
import { parseOpenClawResponse } from "./parse.js";

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function shouldUseWakeTextPayload(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    return path === "/hooks/wake" || path.endsWith("/hooks/wake");
  } catch {
    return false;
  }
}

function buildWakeText(payload: {
  runId: string;
  agentId: string;
  companyId: string;
  taskId: string | null;
  issueId: string | null;
  wakeReason: string | null;
  wakeCommentId: string | null;
  approvalId: string | null;
  approvalStatus: string | null;
  issueIds: string[];
}): string {
  const lines = [
    "Paperclip wake event.",
    "",
    `runId: ${payload.runId}`,
    `agentId: ${payload.agentId}`,
    `companyId: ${payload.companyId}`,
  ];

  if (payload.taskId) lines.push(`taskId: ${payload.taskId}`);
  if (payload.issueId) lines.push(`issueId: ${payload.issueId}`);
  if (payload.wakeReason) lines.push(`wakeReason: ${payload.wakeReason}`);
  if (payload.wakeCommentId) lines.push(`wakeCommentId: ${payload.wakeCommentId}`);
  if (payload.approvalId) lines.push(`approvalId: ${payload.approvalId}`);
  if (payload.approvalStatus) lines.push(`approvalStatus: ${payload.approvalStatus}`);
  if (payload.issueIds.length > 0) lines.push(`issueIds: ${payload.issueIds.join(",")}`);

  lines.push("", "Run your Paperclip heartbeat procedure now.");
  return lines.join("\n");
}

function isTextRequiredResponse(responseText: string): boolean {
  const parsed = parseOpenClawResponse(responseText);
  const parsedError = parsed && typeof parsed.error === "string" ? parsed.error : null;
  if (parsedError && parsedError.toLowerCase().includes("text required")) {
    return true;
  }
  return responseText.toLowerCase().includes("text required");
}

async function sendWebhookRequest(params: {
  url: string;
  method: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
  onLog: AdapterExecutionContext["onLog"];
  signal: AbortSignal;
}): Promise<{ response: Response; responseText: string }> {
  const response = await fetch(params.url, {
    method: params.method,
    headers: params.headers,
    body: JSON.stringify(params.payload),
    signal: params.signal,
  });

  const responseText = await response.text();
  if (responseText.trim().length > 0) {
    await params.onLog("stdout", `[openclaw] response (${response.status}) ${responseText.slice(0, 2000)}\n`);
  } else {
    await params.onLog("stdout", `[openclaw] response (${response.status}) <empty>\n`);
  }

  return { response, responseText };
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { config, runId, agent, context, onLog, onMeta } = ctx;
  const url = asString(config.url, "").trim();
  if (!url) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "OpenClaw adapter missing url",
      errorCode: "openclaw_url_missing",
    };
  }

  const method = asString(config.method, "POST").trim().toUpperCase() || "POST";
  const timeoutSec = Math.max(1, asNumber(config.timeoutSec, 30));
  const headersConfig = parseObject(config.headers) as Record<string, unknown>;
  const payloadTemplate = parseObject(config.payloadTemplate);
  const webhookAuthHeader = nonEmpty(config.webhookAuthHeader);

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  for (const [key, value] of Object.entries(headersConfig)) {
    if (typeof value === "string" && value.trim().length > 0) {
      headers[key] = value;
    }
  }
  if (webhookAuthHeader && !headers.authorization && !headers.Authorization) {
    headers.authorization = webhookAuthHeader;
  }

  const wakePayload = {
    runId,
    agentId: agent.id,
    companyId: agent.companyId,
    taskId: nonEmpty(context.taskId) ?? nonEmpty(context.issueId),
    issueId: nonEmpty(context.issueId),
    wakeReason: nonEmpty(context.wakeReason),
    wakeCommentId: nonEmpty(context.wakeCommentId) ?? nonEmpty(context.commentId),
    approvalId: nonEmpty(context.approvalId),
    approvalStatus: nonEmpty(context.approvalStatus),
    issueIds: Array.isArray(context.issueIds)
      ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [],
  };

  const paperclipBody = {
    ...payloadTemplate,
    paperclip: {
      ...wakePayload,
      context,
    },
  };
  const wakeTextBody = {
    text: buildWakeText(wakePayload),
    mode: "now",
  };

  if (onMeta) {
    await onMeta({
      adapterType: "openclaw",
      command: "webhook",
      commandArgs: [method, url],
      context,
    });
  }

  await onLog("stdout", `[openclaw] invoking ${method} ${url}\n`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSec * 1000);

  try {
    const preferWakeTextPayload = shouldUseWakeTextPayload(url);
    if (preferWakeTextPayload) {
      await onLog("stdout", "[openclaw] using wake text payload for /hooks/wake compatibility\n");
    }

    const initialPayload = preferWakeTextPayload ? wakeTextBody : paperclipBody;

    const { response, responseText } = await sendWebhookRequest({
      url,
      method,
      headers,
      payload: initialPayload,
      onLog,
      signal: controller.signal,
    });

    if (!response.ok) {
      const canRetryWithWakeText = !preferWakeTextPayload && isTextRequiredResponse(responseText);

      if (canRetryWithWakeText) {
        await onLog("stdout", "[openclaw] endpoint requires text payload; retrying with wake compatibility format\n");

        const retry = await sendWebhookRequest({
          url,
          method,
          headers,
          payload: wakeTextBody,
          onLog,
          signal: controller.signal,
        });

        if (retry.response.ok) {
          return {
            exitCode: 0,
            signal: null,
            timedOut: false,
            provider: "openclaw",
            model: null,
            summary: `OpenClaw webhook ${method} ${url} (wake compatibility)`,
            resultJson: {
              status: retry.response.status,
              statusText: retry.response.statusText,
              compatibilityMode: "wake_text",
              response: parseOpenClawResponse(retry.responseText) ?? retry.responseText,
            },
          };
        }

        return {
          exitCode: 1,
          signal: null,
          timedOut: false,
          errorMessage: `OpenClaw webhook failed with status ${retry.response.status}`,
          errorCode: "openclaw_http_error",
          resultJson: {
            status: retry.response.status,
            statusText: retry.response.statusText,
            compatibilityMode: "wake_text",
            response: parseOpenClawResponse(retry.responseText) ?? retry.responseText,
          },
        };
      }

      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage: `OpenClaw webhook failed with status ${response.status}`,
        errorCode: "openclaw_http_error",
        resultJson: {
          status: response.status,
          statusText: response.statusText,
          response: parseOpenClawResponse(responseText) ?? responseText,
        },
      };
    }

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      provider: "openclaw",
      model: null,
      summary: `OpenClaw webhook ${method} ${url}`,
      resultJson: {
        status: response.status,
        statusText: response.statusText,
        response: parseOpenClawResponse(responseText) ?? responseText,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      await onLog("stderr", `[openclaw] request timed out after ${timeoutSec}s\n`);
      return {
        exitCode: null,
        signal: null,
        timedOut: true,
        errorMessage: `Timed out after ${timeoutSec}s`,
        errorCode: "timeout",
      };
    }

    const message = err instanceof Error ? err.message : String(err);
    await onLog("stderr", `[openclaw] request failed: ${message}\n`);
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: message,
      errorCode: "openclaw_request_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}
