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
import { isWhitelisted } from "../services/feishu-whitelist.js";
import { checkAndIncrementQuota } from "../services/feishu-quota.js";
import {
  isAdmin,
  parseAdminCommand,
  adminHelpText,
  addToWhitelist,
  removeFromWhitelist,
  listWhitelist,
  suspendUser,
  unsuspendUser,
} from "../services/feishu-admin.js";
import { handleSelfOnboarding } from "../services/feishu-onboarding.js";

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

      // Hotfix-v10 (Phase 6 SaaS): always reply to the sender's own chat,
      // not hardcoded FEISHU_CHAT_ID. (See v10 commit for rationale.)
      const replyChatId = chatId;

      // Hotfix-v11 (Phase 6 SaaS): hoist sender parsing so whitelist check
      // and metadata write share the same parsed values. Also enables /status
      // and other branches to enforce whitelist consistently.
      const sender = event.sender as { sender_id?: { open_id?: string; user_id?: string; union_id?: string } } | undefined;
      const senderOpenId = sender?.sender_id?.open_id ?? null;
      const senderId = senderOpenId
        ?? sender?.sender_id?.user_id
        ?? sender?.sender_id?.union_id
        ?? null;
      const messageId = (message?.message_id as string | undefined) ?? null;

      logger.info({ text: text.substring(0, 50), chatId, senderOpenId }, "[Feishu] received message");

      // Hotfix-v14 (Phase 6 SaaS): admin command branch. Admins bypass the
      // whitelist/quota gates because they manage them. Non-admin senders
      // attempting `/admin ...` get a silent 200 with a warn log — no
      // information leak to the sender.
      if (text.startsWith("/admin")) {
        if (!senderOpenId) {
          logger.warn({ text: text.substring(0, 30) }, "[Feishu] /admin missing senderOpenId; ignore");
          res.json({ code: 0 });
          return;
        }
        const sIsAdmin = await isAdmin(db, senderOpenId);
        if (!sIsAdmin) {
          logger.warn(
            { senderOpenId, text: text.substring(0, 30) },
            "[Feishu] non-admin /admin attempt (silent 200)",
          );
          res.json({ code: 0 });
          return;
        }
        try {
          const reply = await handleAdminCommand(db, senderOpenId, text);
          await sendTextMessage(replyChatId, reply).catch(() => {});
        } catch (err) {
          logger.error(
            { errMessage: err instanceof Error ? err.message : String(err), senderOpenId },
            "[Feishu] /admin handler failed",
          );
          await sendTextMessage(replyChatId, "❌ /admin 执行失败,请查看 Cloud Run 日志").catch(() => {});
        }
        res.json({ code: 0 });
        return;
      }

      // Whitelist ACL: v20 self-onboarding replaces the prior silent reject.
      // If the sender isn't on the whitelist, route to the onboarding service:
      // either the message matches FEISHU_JOIN_PASSCODE (auto-join) or a
      // pending join request is created and the first admin is DM'd.
      // suspension still wins inside isWhitelisted (suspended → onboarding too,
      // but addToWhitelist is no-op-on-conflict and request is idempotent).
      if (senderOpenId && !(await isWhitelisted(db, senderOpenId))) {
        const result = await handleSelfOnboarding(db, {
          senderOpenId,
          userName: null,
          messageText: text,
        });
        logger.info(
          { senderOpenId, action: result.action, text: text.substring(0, 30) },
          "[Feishu] non-whitelisted sender routed to onboarding",
        );
        await sendTextMessage(replyChatId, result.reply).catch(() => {});
        res.json({ code: 0 });
        return;
      }

      // Hotfix-v12 (Phase 6 SaaS): quota gate. Skip /status and /<cmd> branches
      // (low-cost meta queries); only meter the issue-creating default branch.
      if (senderOpenId && text && !text.startsWith("/") && text !== "状态") {
        const quotaResult = await checkAndIncrementQuota(db, senderOpenId);
        if (!quotaResult.ok) {
          logger.info(
            { senderOpenId, reason: quotaResult.reason, ...quotaResult },
            "[Feishu] sender rejected by quota",
          );
          await sendTextMessage(replyChatId, `⚠️ ${quotaResult.reason}`).catch(() => {});
          res.json({ code: 0 });
          return;
        }
        logger.info(
          {
            senderOpenId,
            monthlyUsed: quotaResult.monthlyUsed,
            monthlyBudget: quotaResult.monthlyBudget,
            userDayCount: quotaResult.userDayCount,
            dailyLimit: quotaResult.dailyLimit,
          },
          "[Feishu] quota OK, command accepted",
        );
      }

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
          // sender/senderId/messageId hoisted to webhook entry above (Hotfix-v11)
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

/**
 * Hotfix-v14: dispatch parsed /admin command against the DB and render a
 * Chinese reply for the feishu chat. Errors propagate to the caller for
 * unified logging.
 */
async function handleAdminCommand(db: Db, adminOpenId: string, text: string): Promise<string> {
  const cmd = parseAdminCommand(text);
  switch (cmd.verb) {
    case "help":
      return adminHelpText();
    case "invalid":
      return `❌ ${cmd.reason}`;
    case "add": {
      await addToWhitelist(db, cmd.openId, adminOpenId, cmd.note);
      return `✅ 已加入白名单:${cmd.openId}${cmd.note ? `\n备注:${cmd.note}` : ""}`;
    }
    case "remove": {
      const n = await removeFromWhitelist(db, cmd.openId);
      return n > 0 ? `✅ 已移除:${cmd.openId}` : `ℹ️ 未在白名单:${cmd.openId}`;
    }
    case "list": {
      const rows = await listWhitelist(db);
      if (rows.length === 0) return "ℹ️ 白名单为空(env seed 不在此列出)";
      const lines = rows.map((r) => {
        const tail = r.note ? `  // ${r.note}` : "";
        return `• ${r.openId}${tail}`;
      });
      return [`📋 白名单 (${rows.length}):`, ...lines].join("\n");
    }
    case "suspend": {
      const until = await suspendUser(db, cmd.openId, cmd.days, adminOpenId, cmd.reason);
      return `✅ 已暂停 ${cmd.openId} ${cmd.days} 天\n到期:${until.toISOString()}${cmd.reason ? `\n原因:${cmd.reason}` : ""}`;
    }
    case "unsuspend": {
      const n = await unsuspendUser(db, cmd.openId);
      return n > 0 ? `✅ 已解除暂停:${cmd.openId}` : `ℹ️ 该用户无活动暂停记录:${cmd.openId}`;
    }
  }
}
