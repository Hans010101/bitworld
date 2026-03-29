/**
 * Telegram Webhook Route for Cloud Deployment
 *
 * POST /api/telegram/webhook
 *
 * In production (Cloud Run), the TG bot switches from polling to webhook mode.
 * This route receives incoming Telegram updates and processes them like the
 * polling bot does locally.
 */
import { Router } from "express";
import { logger } from "../middleware/logger.js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const API_BASE = `http://localhost:${process.env.PORT || 3100}`;
const COMPANY_ID = "576ff49b-f9d7-4539-a718-59ff1654ef46";
const HQ_CEO_ID = "7a463a52-bbf6-4c63-885d-1f0166a943f4";

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

export function telegramWebhookRoutes(): Router {
  const router = Router();

  // Only active in production
  if (process.env.NODE_ENV !== "production") {
    return router;
  }

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
        const health = await fetch(`${API_BASE}/api/health`).then((r) => r.json());
        const agents = await fetch(`${API_BASE}/api/companies/${COMPANY_ID}/agents`).then((r) => r.json()) as Array<{ status: string }>;
        const running = agents.filter((a) => a.status === "running").length;
        const idle = agents.filter((a) => a.status === "idle").length;
        await sendTG(
          `📊 系统状态\n` +
          `服务: ${health.status === "ok" ? "✅ 正常" : "❌ 异常"}\n` +
          `Agent: ${agents.length} 个（${running} 运行中, ${idle} 空闲）`,
          chatId,
        );
      } else if (text.startsWith("/")) {
        // Ignore other bot commands
        await sendTG("未知命令。可用: /status", chatId);
      } else {
        // Treat as a directive for HQ-001-CEO
        const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
        await fetch(`${API_BASE}/api/companies/${COMPANY_ID}/issues`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `[董事长指令] ${text.substring(0, 50)}`,
            description: `董事长通过 Telegram 下达的指令：\n\n> ${text}\n\n---\n\n请拆解并执行此指令。`,
            assigneeAgentId: HQ_CEO_ID,
            priority: "urgent",
            status: "todo",
          }),
        });
        await sendTG(`✅ 指令已下达，HQ-001-CEO 将处理:\n"${text.substring(0, 100)}"`, chatId);
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
