import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "../types.js";
import { asString, parseObject } from "../utils.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);

  const baseUrl = asString(config.baseUrl, "");
  const apiKey = asString(config.apiKey, "");
  const model = asString(config.model, "");

  if (!baseUrl) {
    checks.push({
      code: "openai_base_url_missing",
      level: "error",
      message: "OpenAI-compatible adapter requires a baseUrl.",
      hint: "Set adapterConfig.baseUrl (e.g. https://api.deepseek.com/v1).",
    });
  } else {
    try {
      new URL(baseUrl);
      checks.push({
        code: "openai_base_url_valid",
        level: "info",
        message: `Base URL: ${baseUrl}`,
      });
    } catch {
      checks.push({
        code: "openai_base_url_invalid",
        level: "error",
        message: `Invalid base URL: ${baseUrl}`,
      });
    }
  }

  if (!apiKey) {
    checks.push({
      code: "openai_api_key_missing",
      level: "error",
      message: "OpenAI-compatible adapter requires an apiKey.",
      hint: "Set adapterConfig.apiKey or use model router environment variables.",
    });
  } else {
    checks.push({
      code: "openai_api_key_present",
      level: "info",
      message: `API key configured (length=${apiKey.length}).`,
    });
  }

  if (!model) {
    checks.push({
      code: "openai_model_missing",
      level: "error",
      message: "OpenAI-compatible adapter requires a model name.",
      hint: "Set adapterConfig.model (e.g. deepseek-chat, qwen3-max).",
    });
  } else {
    checks.push({
      code: "openai_model_configured",
      level: "info",
      message: `Model: ${model}`,
    });
  }

  // Probe the endpoint if we have a valid base URL
  if (baseUrl) {
    try {
      const url = new URL(baseUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        try {
          const modelsUrl = `${baseUrl.replace(/\/+$/, "")}/models`;
          const response = await fetch(modelsUrl, {
            method: "GET",
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            signal: controller.signal,
          });
          if (response.ok) {
            checks.push({
              code: "openai_endpoint_probe_ok",
              level: "info",
              message: "API endpoint responded successfully.",
            });
          } else {
            checks.push({
              code: "openai_endpoint_probe_status",
              level: "warn",
              message: `API probe returned HTTP ${response.status}.`,
              hint: "Verify the base URL and API key are correct.",
            });
          }
        } catch (err) {
          checks.push({
            code: "openai_endpoint_probe_failed",
            level: "warn",
            message: err instanceof Error ? err.message : "Endpoint probe failed.",
            hint: "This may be expected in restricted networks.",
          });
        } finally {
          clearTimeout(timeout);
        }
      }
    } catch {
      // URL already validated above
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
