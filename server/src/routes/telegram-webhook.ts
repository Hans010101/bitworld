/**
 * Telegram Webhook Route for Cloud Deployment
 *
 * POST /api/telegram/webhook
 *
 * In production (Cloud Run), the TG bot switches from polling to webhook mode.
 * Uses the DB service layer directly instead of internal HTTP calls, avoiding
 * auth issues in authenticated deployment mode.
 */
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { agents, issues } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { logger } from "../middleware/logger.js";
import { heartbeatService } from "../services/heartbeat.js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const COMPANY_ID = process.env.TG_COMPANY_ID || "a1000000-0000-0000-0000-000000000001";
const HQ_CEO_ID = process.env.TG_HQ_CEO_ID || "b1000000-0000-0000-0000-000000000001";

async function sendTG(text: string, chatId?: string) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId || CHAT_ID,
        text,
        parse_mode: "Markdown",
      }),
    });
  } catch (err) {
    logger.error({ err }, "[TG Webhook] sendMessage failed");
  }
}

export function telegramWebhookRoutes(db: Db): Router {
  const router = Router();

  // Only active in production
  if (process.env.NODE_ENV !== "production") {
    return router;
  }

  const heartbeat = heartbeatService(db);

  router.post("/telegram/webhook", async (req, res) => {
    try {
      const update = req.body;
      const message = update?.message;
      if (!message?.text || !message?.chat?.id) {
        res.sendStatus(200);
        return;
      }

      const chatId = String(message.chat.id);
      const text = message.text.trim();

      // Only process messages from authorized chat
      if (chatId !== CHAT_ID) {
        logger.warn({ chatId }, "[TG Webhook] unauthorized chat");
        res.sendStatus(200);
        return;
      }

      logger.info({ text: text.substring(0, 50), chatId }, "[TG Webhook] received message");

      // Route commands
      if (text === "/status" || text === "状态") {
        try {
          const agentRows = await db
            .select({ status: agents.status })
            .from(agents)
            .where(eq(agents.companyId, COMPANY_ID));
          const running = agentRows.filter((a) => a.status === "running").length;
          const idle = agentRows.filter((a) => a.status === "idle").length;
          await sendTG(
            `📊 系统状态\n` +
            `服务: ✅ 正常\n` +
            `Agent: ${agentRows.length} 个（${running} 运行中, ${idle} 空闲）`,
            chatId,
          );
        } catch (err) {
          logger.error({ err }, "[TG Webhook] status query failed");
          await sendTG("❌ 查询失败，数据库可能不可用", chatId);
        }
      } else if (text.startsWith("/")) {
        await sendTG("未知命令。可用: /status", chatId);
      } else {
        // Create issue directly via DB, then trigger agent wakeup
        try {
          const id = crypto.randomUUID();
          await db.insert(issues).values({
            id,
            companyId: COMPANY_ID,
            title: `[董事长指令] ${text.substring(0, 50)}`,
            description: `董事长通过 Telegram 下达的指令：\n\n> ${text}\n\n---\n\n请拆解并执行此指令。`,
            assigneeAgentId: HQ_CEO_ID,
            priority: "high",
            status: "todo",
          });
          logger.info({ issueId: id, text: text.substring(0, 50) }, "[TG Webhook] issue created");

          // Trigger agent wakeup — without this, the agent won't know about the new issue
          void heartbeat
            .wakeup(HQ_CEO_ID, {
              source: "assignment",
              triggerDetail: "system",
              reason: "issue_assigned",
              contextSnapshot: { issueId: id, source: "telegram_webhook" },
            })
            .then((run) => {
              logger.info({ issueId: id, runId: run?.id ?? null }, "[TG Webhook] agent wakeup triggered");
            })
            .catch((err) => {
              logger.warn({ err, issueId: id }, "[TG Webhook] agent wakeup failed");
            });

          await sendTG(`✅ 指令已下达，HQ-001-CEO 将处理:\n"${text.substring(0, 100)}"`, chatId);
        } catch (err) {
          logger.error({ err }, "[TG Webhook] issue creation failed");
          await sendTG("❌ 创建任务失败，请稍后重试", chatId);
        }
      }

      res.sendStatus(200);
    } catch (err) {
      logger.error({ err }, "[TG Webhook] error processing update");
      res.sendStatus(200); // Always return 200 to Telegram
    }
  });

  // Endpoint to register webhook (called once during deployment)
  router.post("/telegram/register-webhook", async (req, res) => {
    const webhookUrl = req.body?.url;
    if (!webhookUrl || !BOT_TOKEN) {
      res.status(400).json({ error: "Missing url or BOT_TOKEN" });
      return;
    }
    try {
      const result = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl }),
      }).then((r) => r.json());
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Failed to set webhook" });
    }
  });

  return router;
}
