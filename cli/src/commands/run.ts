import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { onboard } from "./onboard.js";
import { doctor } from "./doctor.js";
import { configExists, resolveConfigPath } from "../config/store.js";
import {
  describeLocalInstancePaths,
  resolvePaperclipHomeDir,
  resolvePaperclipInstanceId,
} from "../config/home.js";

interface RunOptions {
  config?: string;
  instance?: string;
  repair?: boolean;
  yes?: boolean;
}

export async function runCommand(opts: RunOptions): Promise<void> {
  const instanceId = resolvePaperclipInstanceId(opts.instance);
  process.env.PAPERCLIP_INSTANCE_ID = instanceId;

  const homeDir = resolvePaperclipHomeDir();
  fs.mkdirSync(homeDir, { recursive: true });

  const paths = describeLocalInstancePaths(instanceId);
  fs.mkdirSync(paths.instanceRoot, { recursive: true });

  const configPath = resolveConfigPath(opts.config);
  process.env.PAPERCLIP_CONFIG = configPath;

  p.intro(pc.bgCyan(pc.black(" paperclipai run ")));
  p.log.message(pc.dim(`Home: ${paths.homeDir}`));
  p.log.message(pc.dim(`Instance: ${paths.instanceId}`));
  p.log.message(pc.dim(`Config: ${configPath}`));

  if (!configExists(configPath)) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      p.log.error("No config found and terminal is non-interactive.");
      p.log.message(`Run ${pc.cyan("paperclipai onboard")} once, then retry ${pc.cyan("paperclipai run")}.`);
      process.exit(1);
    }

    p.log.step("No config found. Starting onboarding...");
    await onboard({ config: configPath });
  }

  p.log.step("Running doctor checks...");
  const summary = await doctor({
    config: configPath,
    repair: opts.repair ?? true,
    yes: opts.yes ?? true,
  });

  if (summary.failed > 0) {
    p.log.error("Doctor found blocking issues. Not starting server.");
    process.exit(1);
  }

  p.log.step("Starting Paperclip server...");
  await importServerEntry();
}

async function importServerEntry(): Promise<void> {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const fileCandidates = [
    path.resolve(projectRoot, "server/dist/index.js"),
    path.resolve(projectRoot, "server/src/index.ts"),
  ];

  const specifierCandidates: string[] = [
    "@paperclipai/server/dist/index.js",
    "@paperclipai/server/src/index.ts",
  ];

  const importErrors: string[] = [];

  for (const specifier of specifierCandidates) {
    try {
      await import(specifier);
      return;
    } catch (err) {
      importErrors.push(`${specifier}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const filePath of fileCandidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      await import(pathToFileURL(filePath).href);
      return;
    } catch (err) {
      importErrors.push(`${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(
    `Could not start Paperclip server entrypoint. Tried: ${[...specifierCandidates, ...fileCandidates].join(", ")}\n` +
      importErrors.join("\n"),
  );
}
