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
 */

import { logger } from "../middleware/logger.js";

const API_BASE = `http://localhost:${process.env.PORT || 3100}`;
const COMPANY_ID = "576ff49b-f9d7-4539-a718-59ff1654ef46";

// Agent IDs
export const AGENTS = {
  NEWS_CEO: "5a77cd8d-eba3-4813-9ced-e7f5408d8527",
  CRYPTO_CEO: "49ff2bdf-7f51-4be0-8c3a-09c044eef244",
  SENTIMENT_CEO: "88bee088-cf53-4394-ad08-9b4647456dd5",
  RESEARCH_CEO: "49b9e34a-1704-43d2-935b-40e923650c24",
  CHO: "8d8c2a99-7fc8-4172-ba4d-8c5b08cace87",
  CFO: "0a77ab78-5686-49fc-9364-df9c5bb5f0d3",
  SECRETARY: "44115df3-6109-4616-99d0-d249c0115dd5",
} as const;

/** Returned by a task's action so the sync /jobs/run handler can track it. */
export interface TaskKick {
  agentId: string;
  /** Set when the task creates an issue; absent for direct-heartbeat tasks. */
  issueId?: string;
}

export interface ScheduledTask {
  name: string;
  /** Cron expression (minute hour dom month dow), Asia/Shanghai */
  cron: string;
  action: () => Promise<TaskKick | null>;
}

async function createIssue(
  agentId: string,
  title: string,
  description: string,
): Promise<TaskKick | null> {
  try {
    const res = await fetch(`${API_BASE}/api/companies/${COMPANY_ID}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        assigneeAgentId: agentId,
        priority: "high",
        status: "todo",
      }),
    });
    const data = (await res.json()) as { id?: string; identifier?: string };
    logger.info({ task: title, identifier: data.identifier }, "[CloudScheduler] issue created");
    if (!data.id) return null;
    return { agentId, issueId: data.id };
  } catch (err) {
    logger.error({ err, task: title }, "[CloudScheduler] failed to create issue");
    return null;
  }
}

async function triggerHeartbeat(agentId: string): Promise<TaskKick | null> {
  try {
    await fetch(`${API_BASE}/api/agents/${agentId}/heartbeat/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "cloud-scheduler" }),
    });
    return { agentId };
  } catch (err) {
    logger.error({ err, agentId }, "[CloudScheduler] heartbeat trigger failed");
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
      action: () => createIssue(AGENTS.NEWS_CEO,
        `[早报] ${getDate()} 全球热点新闻日报`,
        "整理过去24小时全球热点新闻，分为经济/政治/军事/各平台热搜榜，每类5-10条，清单体。篇幅下限2000字。不需要免责声明。"),
    },
    {
      name: "tech-morning",
      cron: "5 8 * * *",
      action: () => createIssue(AGENTS.NEWS_CEO,
        `[早报] ${getDate()} 科技领域日报`,
        "整理过去24小时科技领域重要动态，含AI/新产品/互联网/前沿科技。篇幅下限2000字。不需要免责声明。"),
    },
    {
      name: "crypto-morning",
      cron: "10 8 * * *",
      action: () => createIssue(AGENTS.CRYPTO_CEO,
        `[早报] ${getDate()} 加密货币日报`,
        "整理过去24小时加密货币全面数据：大事件/涨跌幅Top20/主流币价格/关键指标/合约数据/链上数据。篇幅下限2000字。不需要免责声明。"),
    },

    // === 舆情 19:00 ===
    {
      name: "justin-sentiment",
      cron: "0 19 * * *",
      action: () => createIssue(AGENTS.SENTIMENT_CEO,
        `[舆情日报] ${getDate()} 孙宇晨舆情简报`,
        "整理过去24小时孙宇晨舆情：全球媒体报道/中文媒体/X平台/小红书/微博/Reddit/情感分析/风险提示。篇幅下限2000字。不需要免责声明。"),
    },

    // === 晚报 21:00/21:05/21:10 ===
    {
      name: "news-evening",
      cron: "0 21 * * *",
      action: () => createIssue(AGENTS.NEWS_CEO,
        `[晚报] ${getDate()} 全球热点新闻晚报`,
        "整理今天白天最新新闻，与早报不重叠。篇幅下限1000字。不需要免责声明。"),
    },
    {
      name: "tech-evening",
      cron: "5 21 * * *",
      action: () => createIssue(AGENTS.NEWS_CEO,
        `[晚报] ${getDate()} 科技领域晚报`,
        "整理今天白天最新科技动态，与早报不重叠。篇幅下限1000字。不需要免责声明。"),
    },
    {
      name: "crypto-evening",
      cron: "10 21 * * *",
      action: () => createIssue(AGENTS.CRYPTO_CEO,
        `[晚报] ${getDate()} 加密货币晚报`,
        "整理今天白天最新加密货币动态，与早报不重叠。篇幅下限1000字。不需要免责声明。"),
    },

    // === 董秘日报 21:15 ===
    {
      name: "secretary",
      cron: "15 21 * * *",
      action: () => triggerHeartbeat(AGENTS.SECRETARY),
    },

    // === 周报（周一）===
    {
      name: "sentiment-weekly",
      cron: "0 9 * * 1",
      action: () => createIssue(AGENTS.SENTIMENT_CEO,
        `[周报] ${getDate()} 品牌舆情周报`,
        "采集过去一周社媒讨论、行业舆情、品牌提及，生成舆情周报。篇幅下限4000字。不需要免责声明。"),
    },
    {
      name: "research-weekly",
      cron: "30 9 * * 1",
      action: () => createIssue(AGENTS.RESEARCH_CEO,
        `[周报] ${getDate()} 行业研究周报`,
        "研究过去一周加密货币/AI/金融科技三大领域趋势和事件。篇幅下限4000字。不需要免责声明。"),
    },

    // === 周报（周五）===
    {
      name: "github-ai-weekly",
      cron: "0 17 * * 5",
      action: () => createIssue(AGENTS.NEWS_CEO,
        `[周报] ${getDate()} GitHub 热门项目 + AI 周刊`,
        "整理本周GitHub热门项目和AI大事件：概要/Trending项目/AI事件/趋势观察。篇幅2000-3500字。不需要免责声明。"),
    },
    {
      name: "cho-weekly",
      cron: "15 17 * * 5",
      action: () => createIssue(AGENTS.CHO,
        `[周报] ${getDate()} 集团人力效能周报`,
        "统计本周全部Agent工作量、活跃度、完成事项数，分析人力效能趋势，给出优化建议。"),
    },
    {
      name: "cfo-weekly",
      cron: "30 17 * * 5",
      action: () => createIssue(AGENTS.CFO,
        `[周报] ${getDate()} 集团成本效益周报`,
        "统计本周Token消耗、任务成本效益比、异常消耗检测，给出降本增效建议。"),
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

export function startCloudScheduler() {
  if (process.env.NODE_ENV !== "production") {
    logger.info("[CloudScheduler] Skipped — not in production mode (using crontab instead)");
    return;
  }
  // v22: disable internal cron when Cloud Scheduler drives /jobs/run externally.
  if (process.env.USE_INTERNAL_CRON === "false") {
    logger.info("[CloudScheduler] Skipped — USE_INTERNAL_CRON=false (external Cloud Scheduler is driving /jobs/run)");
    return;
  }

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
        task.action().catch((err) => {
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
