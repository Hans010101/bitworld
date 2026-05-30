/**
 * BitWorld Jobs route (v22).
 *
 * Provides external Cloud Scheduler-driven entry points so the Cloud Run
 * service can run with `--cpu-throttling` + `--min-instances=0` (request-
 * billed). Pairs with USE_INTERNAL_CRON=false in cloud-scheduler.ts.
 *
 *   GET  /healthz                       — instant 200, keep-warm + Cloud
 *                                          Run health probe. No auth.
 *   POST /jobs/run?task=<name>          — runs one named ScheduledTask
 *                                          synchronously; returns when the
 *                                          downstream agent run is finished.
 *
 * Auth: `X-Trigger-Token` header must equal env `TRIGGER_SECRET`. Cloud
 * Scheduler should be configured with
 *   --headers="X-Trigger-Token=<TRIGGER_SECRET>"
 * (the spec's `--oidc-service-account-email` alternative would require a
 * google-auth-library dep; not added in this PR).
 *
 * Sync execution rationale: agent runs do their work AFTER the wakeup is
 * enqueued. With cpu-throttling=true, the background work would be
 * starved once the HTTP request returned, so /jobs/run polls until the
 * task's underlying issue / heartbeat_run reaches a terminal state and
 * only then responds. Caller (Cloud Scheduler) must therefore use an
 * attempt-deadline ≥ the Cloud Run --timeout, and Cloud Run --timeout
 * should be raised to e.g. 900s for ~5-minute peak reports.
 */
import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns, issues } from "@paperclipai/db";
import { and, desc, eq, gte, isNotNull, inArray } from "drizzle-orm";
import { logger } from "../middleware/logger.js";
import { buildTasks, type TaskKick } from "../services/cloud-scheduler.js";

const POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 600_000; // 10 min hard cap; align with Cloud Run --timeout

const TERMINAL_ISSUE_STATUSES = ["done", "cancelled"] as const;
const TERMINAL_RUN_STATUSES = ["succeeded", "failed", "cancelled", "timed_out"] as const;

function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll issues table for terminal status. Returns the final status string. */
async function waitForIssueTerminal(db: Db, issueId: string, deadline: number): Promise<string> {
  while (Date.now() < deadline) {
    const row = await db
      .select({ status: issues.status })
      .from(issues)
      .where(eq(issues.id, issueId))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (row && (TERMINAL_ISSUE_STATUSES as readonly string[]).includes(row.status)) {
      return row.status;
    }
    await delay(POLL_INTERVAL_MS);
  }
  return "timeout";
}

/** Poll heartbeat_runs for any run on `agentId` created after `since` that has finished. */
async function waitForHeartbeatTerminal(
  db: Db,
  agentId: string,
  since: Date,
  deadline: number,
): Promise<string> {
  while (Date.now() < deadline) {
    const row = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.agentId, agentId),
          gte(heartbeatRuns.createdAt, since),
          isNotNull(heartbeatRuns.finishedAt),
          inArray(heartbeatRuns.status, TERMINAL_RUN_STATUSES as unknown as string[]),
        ),
      )
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (row) return row.status;
    await delay(POLL_INTERVAL_MS);
  }
  return "timeout";
}

export function jobsRoutes(db: Db): Router {
  const router = Router();

  // Health probe / keep-warm. No auth: must be safe for Cloud Run + Scheduler.
  router.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  router.post("/jobs/run", async (req, res) => {
    const expected = process.env.TRIGGER_SECRET;
    if (!expected) {
      logger.warn({}, "[jobs] TRIGGER_SECRET not configured; rejecting");
      res.status(503).json({ error: "TRIGGER_SECRET not configured" });
      return;
    }
    const provided = req.header("x-trigger-token") ?? undefined;
    if (!tokenMatches(provided, expected)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const taskName = typeof req.query.task === "string" ? req.query.task : "";
    if (!taskName) {
      res.status(400).json({ error: "missing ?task=<name>" });
      return;
    }
    const tasks = buildTasks();
    const task = tasks.find((t) => t.name === taskName);
    if (!task) {
      res.status(404).json({ error: "unknown task", available: tasks.map((t) => t.name) });
      return;
    }

    const timeoutMs = (() => {
      const raw = req.query.timeoutMs;
      if (typeof raw !== "string") return DEFAULT_TIMEOUT_MS;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
      return Math.min(n, DEFAULT_TIMEOUT_MS);
    })();
    const startTs = new Date();
    const deadline = startTs.getTime() + timeoutMs;

    logger.info({ task: taskName, timeoutMs }, "[jobs] starting task (sync)");

    let kick: TaskKick | null;
    try {
      kick = await task.action();
    } catch (err) {
      logger.error(
        { errMessage: err instanceof Error ? err.message : String(err), task: taskName },
        "[jobs] task action threw",
      );
      res.status(500).json({ error: "task action failed", task: taskName });
      return;
    }
    if (!kick) {
      res.status(500).json({ error: "task action returned null (could not start)", task: taskName });
      return;
    }

    const terminal = kick.issueId
      ? await waitForIssueTerminal(db, kick.issueId, deadline)
      : await waitForHeartbeatTerminal(db, kick.agentId, startTs, deadline);

    const durationMs = Date.now() - startTs.getTime();
    const ok = terminal === "done" || terminal === "succeeded";
    const body = {
      task: taskName,
      agentId: kick.agentId,
      issueId: kick.issueId ?? null,
      status: terminal,
      durationMs,
    };
    if (ok) {
      logger.info(body, "[jobs] task completed");
      res.status(200).json(body);
    } else {
      logger.warn(body, "[jobs] task did not complete successfully");
      res.status(terminal === "timeout" ? 504 : 500).json(body);
    }
  });

  return router;
}
