import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asString,
  asStringArray,
  parseObject,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import { discoverOpenCodeModels, ensureOpenCodeModelConfiguredAndAvailable } from "./models.js";
import { parseOpenCodeJsonl } from "./parse.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function summarizeProbeDetail(stdout: string, stderr: string, parsedError: string | null): string | null {
  const raw = parsedError?.trim() || firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  const max = 240;
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

const OPENCODE_AUTH_REQUIRED_RE =
  /(?:auth(?:entication)?\s+required|api\s*key|invalid\s*api\s*key|not\s+logged\s+in|opencode\s+auth\s+login|free\s+usage\s+exceeded)/i;

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "opencode");
  const cwd = asString(config.cwd, process.cwd());

  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
    checks.push({
      code: "opencode_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "opencode_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });

  try {
    await ensureCommandResolvable(command, cwd, runtimeEnv);
    checks.push({
      code: "opencode_command_resolvable",
      level: "info",
      message: `Command is executable: ${command}`,
    });
  } catch (err) {
    checks.push({
      code: "opencode_command_unresolvable",
      level: "error",
      message: err instanceof Error ? err.message : "Command is not executable",
      detail: command,
    });
  }

  const canRunProbe =
    checks.every((check) => check.code !== "opencode_cwd_invalid" && check.code !== "opencode_command_unresolvable");

  let discoveredModels: string[] = [];
  let modelValidationPassed = false;
  if (canRunProbe) {
    try {
      const discovered = await discoverOpenCodeModels({ command, cwd, env });
      discoveredModels = discovered.map((item) => item.id);
      if (discoveredModels.length > 0) {
        checks.push({
          code: "opencode_models_discovered",
          level: "info",
          message: `Discovered ${discoveredModels.length} model(s) from OpenCode providers.`,
        });
      } else {
        checks.push({
          code: "opencode_models_empty",
          level: "error",
          message: "OpenCode returned no models.",
          hint: "Run `opencode models` and verify provider authentication.",
        });
      }
    } catch (err) {
      checks.push({
        code: "opencode_models_discovery_failed",
        level: "error",
        message: err instanceof Error ? err.message : "OpenCode model discovery failed.",
        hint: "Run `opencode models` manually to verify provider auth and config.",
      });
    }
  }

  const configuredModel = asString(config.model, "").trim();
  if (!configuredModel) {
    checks.push({
      code: "opencode_model_required",
      level: "error",
      message: "OpenCode requires a configured model in provider/model format.",
      hint: "Set adapterConfig.model using an ID from `opencode models`.",
    });
  } else if (canRunProbe) {
    try {
      await ensureOpenCodeModelConfiguredAndAvailable({
        model: configuredModel,
        command,
        cwd,
        env,
      });
      checks.push({
        code: "opencode_model_configured",
        level: "info",
        message: `Configured model: ${configuredModel}`,
      });
      modelValidationPassed = true;
    } catch (err) {
      checks.push({
        code: "opencode_model_invalid",
        level: "error",
        message: err instanceof Error ? err.message : "Configured model is unavailable.",
        hint: "Run `opencode models` and choose a currently available provider/model ID.",
      });
    }
  }

  if (canRunProbe && modelValidationPassed) {
    const extraArgs = (() => {
      const fromExtraArgs = asStringArray(config.extraArgs);
      if (fromExtraArgs.length > 0) return fromExtraArgs;
      return asStringArray(config.args);
    })();
    const variant = asString(config.variant, "").trim();
    const probeModel = configuredModel;

    const args = ["run", "--format", "json"];
    args.push("--model", probeModel);
    if (variant) args.push("--variant", variant);
    if (extraArgs.length > 0) args.push(...extraArgs);

    const probe = await runChildProcess(
      `opencode-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      command,
      args,
      {
        cwd,
        env,
        timeoutSec: 60,
        graceSec: 5,
        stdin: "Respond with hello.",
        onLog: async () => {},
      },
    );

    const parsed = parseOpenCodeJsonl(probe.stdout);
    const detail = summarizeProbeDetail(probe.stdout, probe.stderr, parsed.errorMessage);
    const authEvidence = `${parsed.errorMessage ?? ""}\n${probe.stdout}\n${probe.stderr}`.trim();

    if (probe.timedOut) {
      checks.push({
        code: "opencode_hello_probe_timed_out",
        level: "warn",
        message: "OpenCode hello probe timed out.",
        hint: "Retry the probe. If this persists, run OpenCode manually in this working directory.",
      });
    } else if ((probe.exitCode ?? 1) === 0 && !parsed.errorMessage) {
      const summary = parsed.summary.trim();
      const hasHello = /\bhello\b/i.test(summary);
      checks.push({
        code: hasHello ? "opencode_hello_probe_passed" : "opencode_hello_probe_unexpected_output",
        level: hasHello ? "info" : "warn",
        message: hasHello
          ? "OpenCode hello probe succeeded."
          : "OpenCode probe ran but did not return `hello` as expected.",
        ...(summary ? { detail: summary.replace(/\s+/g, " ").trim().slice(0, 240) } : {}),
        ...(hasHello
          ? {}
          : {
              hint: "Run `opencode run --format json` manually and prompt `Respond with hello` to inspect output.",
            }),
      });
    } else if (OPENCODE_AUTH_REQUIRED_RE.test(authEvidence)) {
      checks.push({
        code: "opencode_hello_probe_auth_required",
        level: "warn",
        message: "OpenCode is installed, but provider authentication is not ready.",
        ...(detail ? { detail } : {}),
        hint: "Run `opencode auth login` or set provider credentials, then retry the probe.",
      });
    } else {
      checks.push({
        code: "opencode_hello_probe_failed",
        level: "error",
        message: "OpenCode hello probe failed.",
        ...(detail ? { detail } : {}),
        hint: "Run `opencode run --format json` manually in this working directory to debug.",
      });
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
