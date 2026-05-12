/**
 * Feishu (飞书) Webhook Route for Cloud Deployment
 *
 * POST /api/feishu/webhook
 *
 * Receives im.message.receive_v1 events from Feishu and creates
 * issues for the CEO agent to process.
 */
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { agents, issues } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { logger } from "../middleware/logger.js";
import { heartbeatService } from "../services/heartbeat.js";
import { sendTextMessage } from "../services/feishu-bot.js";

const FEISHU_CHAT_ID = process.env.FEISHU_CHAT_ID ?? "";
const FEISHU_VERIFICATION_TOKEN = process.env.FEISHU_VERIFICATION_TOKEN ?? "";
const COMPANY_ID = process.env.TG_COMPANY_ID || "a1000000-0000-0000-0000-000000000001";
const HQ_CEO_ID = process.env.TG_HQ_CEO_ID || "b1000000-0000-0000-0000-000000000001";

const processedEvents = new Set<string>();
const MAX_PROCESSED = 500;

function recordEvent(eventId: string) {
  processedEvents.add(eventId);
  if (processedEvents.size > MAX_PROCESSED) {
    const first = processedEvents.values().next().value;
    if (first) processedEvents.delete(first);
  }
}

export function feishuWebhookRoutes(db: Db): Router {
  const router = Router();

  if (process.env.NODE_ENV !== "production") {
    return router;
  }

  const heartbeat = heartbeatService(db);

  router.post("/feishu/webhook", async (req, res) => {
    try {
      const body = req.body;

      if (body?.type === "url_verification") {
        res.json({ challenge: body.challenge });
        return;
      }

      const header = body?.header;
      const event = body?.event;
      if (!header || !event) {
        res.json({ code: 0 });
        return;
      }

      if (FEISHU_VERIFICATION_TOKEN && header.token !== FEISHU_VERIFICATION_TOKEN) {
        logger.warn({ token: header.token?.slice(0, 8) }, "[Feishu] invalid verification token");
        res.json({ code: 0 });
        return;
      }

      const eventId = header.event_id as string | undefined;
      if (eventId && processedEvents.has(eventId)) {
        res.json({ code: 0 });
        return;
      }
      if (eventId) recordEvent(eventId);

      if (header.event_type !== "im.message.receive_v1") {
        res.json({ code: 0 });
        return;
      }

      const message = event.message;
      const chatId = message?.chat_id as string | undefined;
      if (!message?.content || !chatId) {
        res.json({ code: 0 });
        return;
      }

      let text = "";
      try {
        const parsed = JSON.parse(message.content as string) as { text?: string };
        text = parsed.text?.trim() ?? "";
      } catch {
        text = typeof message.content === "string" ? message.content.trim() : "";
      }

      if (!text) {
        res.json({ code: 0 });
        return;
      }

      const replyChatId = FEISHU_CHAT_ID || chatId;
      logger.info({ text: text.substring(0, 50), chatId }, "[Feishu] received message");

      if (text === "/status" || text === "状态") {
        try {
          const agentRows = await db.select({ status: agents.status }).from(agents).where(eq(agents.companyId, COMPANY_ID));
          const running = agentRows.filter((a) => a.status === "running").length;
          const idle = agentRows.filter((a) => a.status === "idle").length;
          await sendTextMessage(replyChatId, `📊 系统状态\n服务: ✅ 正常\nAgent: ${agentRows.length} 个（${running} 运行中, ${idle} 空闲）`);
        } catch (err) {
          logger.error({ err }, "[Feishu] status query failed");
          await sendTextMessage(replyChatId, "❌ 查询失败，数据库可能不可用").catch(() => {});
        }
      } else if (text.startsWith("/")) {
        await sendTextMessage(replyChatId, "未知命令。可用: /status").catch(() => {});
      } else {
        try {
          const id = crypto.randomUUID();
          const sender = event.sender as { sender_id?: { open_id?: string; user_id?: string; union_id?: string } } | undefined;
          const senderId = sender?.sender_id?.open_id
            ?? sender?.sender_id?.user_id
            ?? sender?.sender_id?.union_id
            ?? null;
          const messageId = (message?.message_id as string | undefined) ?? null;
          await db.insert(issues).values({
            id,
            companyId: COMPANY_ID,
            title: `[董事长指令] ${text.substring(0, 50)}`,
            description: `董事长通过飞书下达的指令：\n\n> ${text}\n\n---\n\n请拆解并执行此指令。`,
            assigneeAgentId: HQ_CEO_ID,
            priority: "high",
            status: "todo",
            metadata: {
              source: "feishu",
              feishuChatId: chatId,
              feishuMessageId: messageId,
              feishuUserId: senderId,
            },
          });
          logger.info({ issueId: id, text: text.substring(0, 50) }, "[Feishu] issue created");

          void heartbeat
            .wakeup(HQ_CEO_ID, {
              source: "assignment",
              triggerDetail: "system",
              reason: "issue_assigned",
              contextSnapshot: { issueId: id, source: "feishu_webhook" },
            })
            .then((run) => {
              logger.info({ issueId: id, runId: run?.id ?? null }, "[Feishu] agent wakeup triggered");
            })
            .catch((err) => {
              logger.warn({ err, issueId: id }, "[Feishu] agent wakeup failed");
            });

          await sendTextMessage(replyChatId, `✅ 指令已下达，HQ-001-CEO 将处理:\n"${text.substring(0, 100)}"`).catch(() => {});
        } catch (err) {
          logger.error({ err }, "[Feishu] issue creation failed");
          await sendTextMessage(replyChatId, "❌ 创建任务失败，请稍后重试").catch(() => {});
        }
      }

      res.json({ code: 0 });
    } catch (err) {
      logger.error({ err }, "[Feishu] error processing event");
      res.json({ code: 0 });
    }
  });

  return router;
}
