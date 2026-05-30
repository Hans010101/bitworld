/**
 * BitWorld Cloud Scheduler
 *
 * Replaces crontab-based daily-tasks.sh for cloud deployment (Cloud Run).
 * Only active when NODE_ENV === "production" AND USE_INTERNAL_CRON !== "false".
 * Uses the built-in cron parser and setInterval to trigger tasks.
 *
 * v22: tasks are also exported so the /jobs/run HTTP route can invoke a task
 * by name synchronously (for Cloud Scheduler-driven, cpu-throttled deploys).
 * When external scheduling is wired up, set USE_INTERNAL_CRON=false to
 * disable this internal cron and avoid double-firing.
 *
 * v22.2: tasks are now declarative (TaskSpec) and dispatched via
 * executeTaskDirect (db + heartbeat in-process). The previous HTTP self-call
 * to `${API_BASE}/api/...` failed in production because actorMiddleware sets
 * actor.type="none" on unauthenticated requests and downstream routes throw
 * via assertCompanyAccess. Internal cron AND /jobs/run both go through the
 * shared executor now, matching the working precedent in feishu-webhook.ts.
 */

import crypto from "node:crypto";
import type { Db } from "@paperclipai/db";
import { agents, issues } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { logger } from "../middleware/logger.js";
import { heartbeatService } from "./heartbeat.js";

/**
 * Canonical agent NAMES (not UUIDs).
 *
 * v22.3: agent UUIDs are `defaultRandom()` per environment, so the old
 * hardcoded UUIDs were dev-DB values absent in prod ("Agent not found").
 * Names are explicitly seeded (see server/src/routes/admin-seed.ts) and are
 * therefore stable across environments. We resolve the real id (and the
 * agent's own companyId) by name at dispatch time.
 */
export const AGENT_NAMES = {
  NEWS_CEO: "News-001-CEO",
  CRYPTO_CEO: "Crypto-001-CEO",
  SENTIMENT_CEO: "Sentiment-001-CEO",
  RESEARCH_CEO: "Research-001-CEO",
  CHO: "HQ-004-CHO",
  CFO: "HQ-005-CFO",
  SECRETARY: "HQ-003-董秘",
} as const;

/** Returned by executeTaskDirect so /jobs/run can poll for completion. */
export interface TaskKick {
  agentId: string;
  /** Set when the task creates an issue; absent for direct-heartbeat tasks. */
  issueId?: string;
}

/** Declarative task definition. Dispatchers (cron, jobs route) consume this. */
export type TaskSpec =
  | { kind: "issue"; agentName: string; title: string; description: string }
  | { kind: "tick"; agentName: string };

export interface ScheduledTask {
  name: string;
  /** Cron expression (minute hour dom month dow), Asia/Shanghai */
  cron: string;
  spec: TaskSpec;
}

/**
 * Dispatch a TaskSpec using in-process `db` + `heartbeat`. No HTTP self-call,
 * no auth boundary. Mirrors the create-issue-then-wakeup pattern from
 * feishu-webhook.ts (which has been working in production).
 *
 * Resolves the assignee by NAME (UUIDs differ per environment) and uses that
 * agent's own companyId, so nothing depends on a hardcoded UUID. On a name
 * miss, the error lists all available agent names for instant diagnosis.
 *
 * Fail-safe: returns null on any error so /jobs/run can surface a 5xx
 * instead of silently hanging in the poll loop.
 */
export async function executeTaskDirect(
  db: Db,
  heartbeat: ReturnType<typeof heartbeatService>,
  taskName: string,
  spec: TaskSpec,
): Promise<TaskKick | null> {
  try {
    // Resolve agent by name (env-independent). Pull its companyId too so the
    // issue insert never depends on a hardcoded company UUID.
    const agent = await db
      .select({ id: agents.id, companyId: agents.companyId })
      .from(agents)
      .where(eq(agents.name, spec.agentName))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (!agent) {
      const all = await db.select({ name: agents.name }).from(agents);
      throw new Error(
        `Agent not found by name "${spec.agentName}" for task "${taskName}". ` +
          `Available names: ${all.map((a) => a.name).join(", ") || "(none)"}`,
      );
    }

    if (spec.kind === "issue") {
      const issueId = crypto.randomUUID();
      await db.insert(issues).values({
        id: issueId,
        companyId: agent.companyId,
        title: spec.title,
        description: spec.description,
        assigneeAgentId: agent.id,
        priority: "high",
        status: "todo",
        metadata: { source: "cloud-scheduler", taskName },
      });
      logger.info({ task: taskName, issueId, agentName: spec.agentName }, "[CloudScheduler] issue created");
      // Same pattern as feishu-webhook.ts: insert row then wake the assignee.
      // We await here (not void) so any wakeup error surfaces in this task
      // run's error path. Heartbeat work itself happens async after wakeup
      // returns the run record; /jobs/run polls heartbeat_runs for terminal.
      await heartbeat.wakeup(agent.id, {
        source: "assignment",
        triggerDetail: "system",
        reason: "issue_assigned",
        payload: { issueId, mutation: "create" },
        contextSnapshot: { issueId, source: "cloud-scheduler", taskName },
      });
      return { agentId: agent.id, issueId };
    }
    // spec.kind === "tick"
    await heartbeat.invoke(agent.id, "on_demand", { source: "cloud-scheduler", taskName }, "system");
    logger.info({ task: taskName, agentId: agent.id, agentName: spec.agentName }, "[CloudScheduler] tick triggered");
    return { agentId: agent.id };
  } catch (err) {
    // BW-93: explicit errMessage to avoid pino's err reserved-key serialization
    logger.error(
      { errMessage: err instanceof Error ? err.message : String(err), task: taskName },
      "[CloudScheduler] executeTaskDirect failed",
    );
    return null;
  }
}

function getDate(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

// Task definitions — same as scripts/daily-tasks.sh
export function buildTasks(): ScheduledTask[] {
  return [
    // === 早报 08:00/08:05/08:10 ===
    {
      name: "news-morning",
      cron: "0 8 * * *",
      spec: {
        kind: "issue",
        agentName: AGENT_NAMES.NEWS_CEO,
        title: `[早报] ${getDate()} 全球热点新闻日报`,
        description: "整理过去24小时全球热点新闻，分为经济/政治/军事/各平台热搜榜，每类5-10条，清单体。篇幅下限2000字。不需要免责声明。",
      },
    },
    {
      name: "tech-morning",
      cron: "5 8 * * *",
      spec: {
        kind: "issue",
        agentName: AGENT_NAMES.NEWS_CEO,
        title: `[早报] ${getDate()} 科技领域日报`,
        description: "整理过去24小时科技领域重要动态，含AI/新产品/互联网/前沿科技。篇幅下限2000字。不需要免责声明。",
      },
    },
    {
      name: "crypto-morning",
      cron: "10 8 * * *",
      spec: {
        kind: "issue",
        agentName: AGENT_NAMES.CRYPTO_CEO,
        title: `[早报] ${getDate()} 加密货币日报`,
        description: "整理过去24小时加密货币全面数据：大事件/涨跌幅Top20/主流币价格/关键指标/合约数据/链上数据。篇幅下限2000字。不需要免责声明。",
      },
    },

    // === 舆情 19:00 ===
    {
      name: "justin-sentiment",
      cron: "0 19 * * *",
      spec: {
        kind: "issue",
        agentName: AGENT_NAMES.SENTIMENT_CEO,
        title: `[舆情日报] ${getDate()} 孙宇晨舆情简报`,
        description: "整理过去24小时孙宇晨舆情：全球媒体报道/中文媒体/X平台/小红书/微博/Reddit/情感分析/风险提示。篇幅下限2000字。不需要免责声明。",
      },
    },

    // === 晚报 21:00/21:05/21:10 ===
    {
      name: "news-evening",
      cron: "0 21 * * *",
      spec: {
        kind: "issue",
        agentName: AGENT_NAMES.NEWS_CEO,
        title: `[晚报] ${getDate()} 全球热点新闻晚报`,
        description: "整理今天白天最新新闻，与早报不重叠。篇幅下限1000字。不需要免责声明。",
      },
    },
    {
      name: "tech-evening",
      cron: "5 21 * * *",
      spec: {
        kind: "issue",
        agentName: AGENT_NAMES.NEWS_CEO,
        title: `[晚报] ${getDate()} 科技领域晚报`,
        description: "整理今天白天最新科技动态，与早报不重叠。篇幅下限1000字。不需要免责声明。",
      },
    },
    {
      name: "crypto-evening",
      cron: "10 21 * * *",
      spec: {
        kind: "issue",
        agentName: AGENT_NAMES.CRYPTO_CEO,
        title: `[晚报] ${getDate()} 加密货币晚报`,
        description: "整理今天白天最新加密货币动态，与早报不重叠。篇幅下限1000字。不需要免责声明。",
      },
    },

    // === 董秘日报 21:15 ===
    {
      name: "secretary",
      cron: "15 21 * * *",
      spec: { kind: "tick", agentName: AGENT_NAMES.SECRETARY },
    },

    // === 周报（周一）===
    {
      name: "sentiment-weekly",
      cron: "0 9 * * 1",
      spec: {
        kind: "issue",
        agentName: AGENT_NAMES.SENTIMENT_CEO,
        title: `[周报] ${getDate()} 品牌舆情周报`,
        description: "采集过去一周社媒讨论、行业舆情、品牌提及，生成舆情周报。篇幅下限4000字。不需要免责声明。",
      },
    },
    {
      name: "research-weekly",
      cron: "30 9 * * 1",
      spec: {
        kind: "issue",
        agentName: AGENT_NAMES.RESEARCH_CEO,
        title: `[周报] ${getDate()} 行业研究周报`,
        description: "研究过去一周加密货币/AI/金融科技三大领域趋势和事件。篇幅下限4000字。不需要免责声明。",
      },
    },

    // === 周报（周五）===
    {
      name: "github-ai-weekly",
      cron: "0 17 * * 5",
      spec: {
        kind: "issue",
        agentName: AGENT_NAMES.NEWS_CEO,
        title: `[周报] ${getDate()} GitHub 热门项目 + AI 周刊`,
        description: "整理本周GitHub热门项目和AI大事件：概要/Trending项目/AI事件/趋势观察。篇幅2000-3500字。不需要免责声明。",
      },
    },
    {
      name: "cho-weekly",
      cron: "15 17 * * 5",
      spec: {
        kind: "issue",
        agentName: AGENT_NAMES.CHO,
        title: `[周报] ${getDate()} 集团人力效能周报`,
        description: "统计本周全部Agent工作量、活跃度、完成事项数，分析人力效能趋势，给出优化建议。",
      },
    },
    {
      name: "cfo-weekly",
      cron: "30 17 * * 5",
      spec: {
        kind: "issue",
        agentName: AGENT_NAMES.CFO,
        title: `[周报] ${getDate()} 集团成本效益周报`,
        description: "统计本周Token消耗、任务成本效益比、异常消耗检测，给出降本增效建议。",
      },
    },
  ];
}

/**
 * Parse a 5-field cron expression and check if `now` matches.
 * Simple implementation for minute-level precision.
 */
function cronMatches(cron: string, now: Date): boolean {
  const shanghaiStr = now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" });
  const sh = new Date(shanghaiStr);
  const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = cron.split(" ");

  const minute = sh.getMinutes();
  const hour = sh.getHours();
  const dom = sh.getDate();
  const month = sh.getMonth() + 1;
  const dow = sh.getDay(); // 0=Sun

  return (
    fieldMatches(minExpr, minute) &&
    fieldMatches(hourExpr, hour) &&
    fieldMatches(domExpr, dom) &&
    fieldMatches(monExpr, month) &&
    fieldMatches(dowExpr, dow)
  );
}

function fieldMatches(expr: string, value: number): boolean {
  if (expr === "*") return true;
  // Handle comma-separated
  return expr.split(",").some((part) => {
    if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      return value >= lo && value <= hi;
    }
    if (part.includes("/")) {
      const [base, step] = part.split("/");
      const stepN = Number(step);
      const baseN = base === "*" ? 0 : Number(base);
      return (value - baseN) % stepN === 0 && value >= baseN;
    }
    return Number(part) === value;
  });
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const lastFired = new Map<string, string>(); // name → "YYYY-MM-DD HH:MM"

export function startCloudScheduler(db: Db) {
  if (process.env.NODE_ENV !== "production") {
    logger.info("[CloudScheduler] Skipped — not in production mode (using crontab instead)");
    return;
  }
  // v22: disable internal cron when Cloud Scheduler drives /jobs/run externally.
  if (process.env.USE_INTERNAL_CRON === "false") {
    logger.info("[CloudScheduler] Skipped — USE_INTERNAL_CRON=false (external Cloud Scheduler is driving /jobs/run)");
    return;
  }

  const heartbeat = heartbeatService(db);
  const tasks = buildTasks();
  logger.info({ taskCount: tasks.length }, "[CloudScheduler] Starting cloud scheduler");

  // Check every 30 seconds
  schedulerInterval = setInterval(() => {
    const now = new Date();
    const shanghaiStr = now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" });
    const sh = new Date(shanghaiStr);
    const minuteKey = `${sh.getFullYear()}-${String(sh.getMonth() + 1).padStart(2, "0")}-${String(sh.getDate()).padStart(2, "0")} ${String(sh.getHours()).padStart(2, "0")}:${String(sh.getMinutes()).padStart(2, "0")}`;

    for (const task of tasks) {
      if (cronMatches(task.cron, now) && lastFired.get(task.name) !== minuteKey) {
        lastFired.set(task.name, minuteKey);
        logger.info({ task: task.name, time: minuteKey }, "[CloudScheduler] Firing task");
        executeTaskDirect(db, heartbeat, task.name, task.spec).catch((err) => {
          logger.error({ err, task: task.name }, "[CloudScheduler] Task execution error");
        });
      }
    }
  }, 30_000);

  // List loaded tasks
  for (const t of tasks) {
    logger.info({ name: t.name, cron: t.cron }, "[CloudScheduler] Registered task");
  }
}

export function stopCloudScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info("[CloudScheduler] Stopped");
  }
}
