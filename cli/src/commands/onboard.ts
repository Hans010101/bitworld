import * as p from "@clack/prompts";
import pc from "picocolors";
import { configExists, readConfig, resolveConfigPath, writeConfig } from "../config/store.js";
import type { PaperclipConfig } from "../config/schema.js";
import { ensureAgentJwtSecret, resolveAgentJwtEnvFile } from "../config/env.js";
import { ensureLocalSecretsKeyFile } from "../config/secrets-key.js";
import { promptDatabase } from "../prompts/database.js";
import { promptLlm } from "../prompts/llm.js";
import { promptLogging } from "../prompts/logging.js";
import { defaultSecretsConfig } from "../prompts/secrets.js";
import { defaultStorageConfig, promptStorage } from "../prompts/storage.js";
import { promptServer } from "../prompts/server.js";
import { describeLocalInstancePaths, resolvePaperclipInstanceId } from "../config/home.js";
import { bootstrapCeoInvite } from "./auth-bootstrap-ceo.js";
import { printPaperclipCliBanner } from "../utils/banner.js";

export async function onboard(opts: { config?: string }): Promise<void> {
  printPaperclipCliBanner();
  p.intro(pc.bgCyan(pc.black(" paperclipai onboard ")));
  const instance = describeLocalInstancePaths(resolvePaperclipInstanceId());
  p.log.message(
    pc.dim(
      `Local home: ${instance.homeDir} | instance: ${instance.instanceId} | config: ${resolveConfigPath(opts.config)}`,
    ),
  );

  // Check for existing config
  if (configExists(opts.config)) {
    const configPath = resolveConfigPath(opts.config);
    p.log.message(pc.dim(`${configPath} exists, updating config`));

    try {
      readConfig(opts.config);
    } catch (err) {
      p.log.message(
        pc.yellow(
          `Existing config appears invalid and will be updated.\n${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }

  // Database
  p.log.step(pc.bold("Database"));
  const database = await promptDatabase();

  if (database.mode === "postgres" && database.connectionString) {
    const s = p.spinner();
    s.start("Testing database connection...");
    try {
      const { createDb } = await import("@paperclipai/db");
      const db = createDb(database.connectionString);
      await db.execute("SELECT 1");
      s.stop("Database connection successful");
    } catch (err) {
      s.stop(pc.yellow("Could not connect to database — you can fix this later with `paperclipai doctor`"));
    }
  }

  // LLM
  p.log.step(pc.bold("LLM Provider"));
  const llm = await promptLlm();

  if (llm?.apiKey) {
    const s = p.spinner();
    s.start("Validating API key...");
    try {
      if (llm.provider === "claude") {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": llm.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-5-20250929",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
        });
        if (res.ok || res.status === 400) {
          s.stop("API key is valid");
        } else if (res.status === 401) {
          s.stop(pc.yellow("API key appears invalid — you can update it later"));
        } else {
          s.stop(pc.yellow("Could not validate API key — continuing anyway"));
        }
      } else {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${llm.apiKey}` },
        });
        if (res.ok) {
          s.stop("API key is valid");
        } else if (res.status === 401) {
          s.stop(pc.yellow("API key appears invalid — you can update it later"));
        } else {
          s.stop(pc.yellow("Could not validate API key — continuing anyway"));
        }
      }
    } catch {
      s.stop(pc.yellow("Could not reach API — continuing anyway"));
    }
  }

  // Logging
  p.log.step(pc.bold("Logging"));
  const logging = await promptLogging();

  // Server
  p.log.step(pc.bold("Server"));
  const { server, auth } = await promptServer();

  // Storage
  p.log.step(pc.bold("Storage"));
  const storage = await promptStorage(defaultStorageConfig());

  // Secrets
  p.log.step(pc.bold("Secrets"));
  const secrets = defaultSecretsConfig();
  p.log.message(
    pc.dim(
      `Using defaults: provider=${secrets.provider}, strictMode=${secrets.strictMode}, keyFile=${secrets.localEncrypted.keyFilePath}`,
    ),
  );

  const jwtSecret = ensureAgentJwtSecret();
  const envFilePath = resolveAgentJwtEnvFile();
  if (jwtSecret.created) {
    p.log.success(`Created ${pc.cyan("PAPERCLIP_AGENT_JWT_SECRET")} in ${pc.dim(envFilePath)}`);
  } else if (process.env.PAPERCLIP_AGENT_JWT_SECRET?.trim()) {
    p.log.info(`Using existing ${pc.cyan("PAPERCLIP_AGENT_JWT_SECRET")} from environment`);
  } else {
    p.log.info(`Using existing ${pc.cyan("PAPERCLIP_AGENT_JWT_SECRET")} in ${pc.dim(envFilePath)}`);
  }

  // Assemble and write config
  const config: PaperclipConfig = {
    $meta: {
      version: 1,
      updatedAt: new Date().toISOString(),
      source: "onboard",
    },
    ...(llm && { llm }),
    database,
    logging,
    server,
    auth,
    storage,
    secrets,
  };

  const keyResult = ensureLocalSecretsKeyFile(config, resolveConfigPath(opts.config));
  if (keyResult.status === "created") {
    p.log.success(`Created local secrets key file at ${pc.dim(keyResult.path)}`);
  } else if (keyResult.status === "existing") {
    p.log.message(pc.dim(`Using existing local secrets key file at ${keyResult.path}`));
  }

  writeConfig(config, opts.config);

  p.note(
    [
      `Database: ${database.mode}`,
      llm ? `LLM: ${llm.provider}` : "LLM: not configured",
      `Logging: ${logging.mode} → ${logging.logDir}`,
      `Server: ${server.deploymentMode}/${server.exposure} @ ${server.host}:${server.port}`,
      `Allowed hosts: ${server.allowedHostnames.length > 0 ? server.allowedHostnames.join(", ") : "(loopback only)"}`,
      `Auth URL mode: ${auth.baseUrlMode}${auth.publicBaseUrl ? ` (${auth.publicBaseUrl})` : ""}`,
      `Storage: ${storage.provider}`,
      `Secrets: ${secrets.provider} (strict mode ${secrets.strictMode ? "on" : "off"})`,
      `Agent auth: PAPERCLIP_AGENT_JWT_SECRET configured`,
    ].join("\n"),
    "Configuration saved",
  );

  p.log.info(`Run ${pc.cyan("pnpm paperclipai doctor")} to verify your setup.`);
  p.log.message(
    `Before starting Paperclip, export ${pc.cyan("PAPERCLIP_AGENT_JWT_SECRET")} from ${pc.dim(envFilePath)} (for example: ${pc.dim(`set -a; source ${envFilePath}; set +a`)})`,
  );
  if (server.deploymentMode === "authenticated") {
    p.log.step("Generating bootstrap CEO invite");
    await bootstrapCeoInvite({ config: opts.config });
  }
  p.outro("You're all set!");
}
