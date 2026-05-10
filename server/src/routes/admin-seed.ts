/**
 * BitWorld Admin Seed Route (one-shot, idempotent)
 *
 * POST /api/admin/seed-bitworld
 * Header: X-Seed-Token: <SEED_TOKEN env value>
 *
 * Seeds 1 company + 23 agents (b1-b5 series) into the database
 * using ON CONFLICT DO NOTHING semantics. Safe to call repeatedly.
 */
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { agents, companies } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const COMPANY_ID = "a1000000-0000-0000-0000-000000000001";

const HQ_CEO = "b1000000-0000-0000-0000-000000000001";
const CRYPTO_CEO = "b2000000-0000-0000-0000-000000000001";
const NEWS_CEO = "b3000000-0000-0000-0000-000000000001";
const SENTIMENT_CEO = "b4000000-0000-0000-0000-000000000001";
const RESEARCH_CEO = "b5000000-0000-0000-0000-000000000001";

const COMPANY_ROW = {
  id: COMPANY_ID,
  name: "BitWorld 集团",
  description: "集团化 AI 自动运营系统,1 公司 5 事业部 23 Agent",
  status: "active",
  issuePrefix: "BIT",
  issueCounter: 0,
  budgetMonthlyCents: 10_000_000,
  spentMonthlyCents: 0,
  requireBoardApprovalForNewAgents: false,
  brandColor: "#FF6B35",
};

type AgentRow = {
  id: string;
  companyId: string;
  name: string;
  role: string;
  title: string;
  status: string;
  reportsTo: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown>;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
};

function agent(
  id: string,
  name: string,
  role: string,
  title: string,
  reportsTo: string | null,
  tier: "tier1" | "tier2",
  budgetCents: number,
): AgentRow {
  return {
    id,
    companyId: COMPANY_ID,
    name,
    role,
    title,
    status: "idle",
    reportsTo,
    adapterType: "openai_compatible",
    adapterConfig: {},
    runtimeConfig: { tier },
    budgetMonthlyCents: budgetCents,
    spentMonthlyCents: 0,
  };
}

const AGENT_ROWS: AgentRow[] = [
  // 总部 5 人 (b1)
  agent(HQ_CEO, "HQ-001-CEO", "ceo", "集团首席执行官", null, "tier2", 2_000_000),
  agent("b1000000-0000-0000-0000-000000000002", "HQ-002-CTO", "cto", "首席技术官", HQ_CEO, "tier1", 500_000),
  agent("b1000000-0000-0000-0000-000000000003", "HQ-003-董秘", "secretary", "董事长秘书", HQ_CEO, "tier1", 500_000),
  agent("b1000000-0000-0000-0000-000000000004", "HQ-004-CHO", "cho", "首席人力官", HQ_CEO, "tier1", 500_000),
  agent("b1000000-0000-0000-0000-000000000005", "HQ-005-CFO", "cfo", "首席财务官", HQ_CEO, "tier1", 500_000),

  // 加密交易事业部 5 人 (b2)
  agent(CRYPTO_CEO, "Crypto-001-CEO", "division_ceo", "加密交易事业部负责人", HQ_CEO, "tier2", 1_000_000),
  agent("b2000000-0000-0000-0000-000000000002", "Crypto-002-策略", "analyst", "交易策略分析师", CRYPTO_CEO, "tier1", 300_000),
  agent("b2000000-0000-0000-0000-000000000003", "Crypto-003-风控", "risk", "风险控制官", CRYPTO_CEO, "tier1", 300_000),
  agent("b2000000-0000-0000-0000-000000000004", "Crypto-004-开发", "developer", "加密系统开发", CRYPTO_CEO, "tier1", 300_000),
  agent("b2000000-0000-0000-0000-000000000005", "Crypto-005-数据", "data", "数据工程师", CRYPTO_CEO, "tier1", 300_000),

  // 新闻雷达事业部 5 人 (b3)
  agent(NEWS_CEO, "News-001-CEO", "division_ceo", "新闻雷达事业部负责人", HQ_CEO, "tier2", 1_000_000),
  agent("b3000000-0000-0000-0000-000000000002", "News-002-采集", "collector", "新闻采集员", NEWS_CEO, "tier1", 300_000),
  agent("b3000000-0000-0000-0000-000000000003", "News-003-分析", "analyst", "热点分析师", NEWS_CEO, "tier1", 300_000),
  agent("b3000000-0000-0000-0000-000000000004", "News-004-编译", "editor", "编译整理员", NEWS_CEO, "tier1", 300_000),
  agent("b3000000-0000-0000-0000-000000000005", "News-005-简报", "writer", "简报撰写员", NEWS_CEO, "tier1", 300_000),

  // 舆情应对事业部 4 人 (b4)
  agent(SENTIMENT_CEO, "Sentiment-001-CEO", "division_ceo", "舆情应对事业部负责人", HQ_CEO, "tier2", 1_000_000),
  agent("b4000000-0000-0000-0000-000000000002", "Sentiment-002-分析师", "analyst", "舆情研判分析师", SENTIMENT_CEO, "tier1", 300_000),
  agent("b4000000-0000-0000-0000-000000000003", "Sentiment-003-采集", "collector", "舆情数据采集员", SENTIMENT_CEO, "tier1", 300_000),
  agent("b4000000-0000-0000-0000-000000000004", "Sentiment-004-报告", "writer", "舆情报告撰写员", SENTIMENT_CEO, "tier1", 300_000),

  // 市场研究事业部 4 人 (b5)
  agent(RESEARCH_CEO, "Research-001-CEO", "division_ceo", "市场研究事业部负责人", HQ_CEO, "tier2", 1_000_000),
  agent("b5000000-0000-0000-0000-000000000002", "Research-002-主编", "editor", "研究主编", RESEARCH_CEO, "tier1", 300_000),
  agent("b5000000-0000-0000-0000-000000000003", "Research-003-写手", "writer", "研究报告撰写员", RESEARCH_CEO, "tier1", 300_000),
  agent("b5000000-0000-0000-0000-000000000004", "Research-004-数据", "data", "研究数据分析员", RESEARCH_CEO, "tier1", 300_000),
];

export function adminSeedRoutes(db: Db): Router {
  const router = Router();

  router.post("/admin/seed-bitworld", async (req, res) => {
    const expectedToken = process.env.SEED_TOKEN;
    if (!expectedToken) {
      res.status(503).json({ error: "SEED_TOKEN not configured" });
      return;
    }
    const providedToken = req.header("x-seed-token");
    if (providedToken !== expectedToken) {
      logger.warn({ ip: req.ip }, "[AdminSeed] invalid token");
      res.status(401).json({ error: "invalid token" });
      return;
    }

    try {
      const insertedCompanies = await db
        .insert(companies)
        .values(COMPANY_ROW)
        .onConflictDoNothing()
        .returning({ id: companies.id });

      const insertedAgents = await db
        .insert(agents)
        .values(AGENT_ROWS)
        .onConflictDoNothing()
        .returning({ id: agents.id });

      const result = {
        ok: true,
        companyId: COMPANY_ID,
        companiesCreated: insertedCompanies.length,
        companiesSkipped: 1 - insertedCompanies.length,
        agentsTotal: AGENT_ROWS.length,
        agentsCreated: insertedAgents.length,
        agentsSkipped: AGENT_ROWS.length - insertedAgents.length,
      };
      logger.info(result, "[AdminSeed] seed completed");
      res.json(result);
    } catch (err) {
      logger.error({ err }, "[AdminSeed] seed failed");
      res.status(500).json({ error: String((err as Error)?.message ?? err) });
    }
  });

  return router;
}
