/**
 * Hotfix-v20: Feishu self-onboarding service.
 *
 * Replaces the prior silent-reject path for non-whitelisted senders with two
 * explicit branches:
 *
 *   1. Passcode self-serve: if the message text exactly equals
 *      env `FEISHU_JOIN_PASSCODE` (trim-then-equal, not substring), the
 *      sender is added to the DB whitelist immediately and gets a success
 *      reply. No admin involvement.
 *
 *   2. Approval request: otherwise, a row is inserted into
 *      `feishu_join_requests` (idempotent on open_id — duplicates dedupe)
 *      and the first admin from `FEISHU_ADMIN_OPEN_IDS` is DM'd with the
 *      requester's open_id and a copy-paste `/admin add` line. The sender
 *      is told their request is pending.
 *
 * The Feishu webhook payload doesn't include a display name on
 * `im.message.receive_v1`, so we fall back to the last 8 chars of open_id
 * when no name is provided.
 *
 * Fail-safe: any DB / send error returns a reply but never throws to the
 * webhook caller.
 */
import type { Db } from "@paperclipai/db";
import { feishuJoinRequests } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { logger } from "../middleware/logger.js";
import { addToWhitelist } from "./feishu-admin.js";
import { sendDirectMessageToOpenId } from "./feishu-bot.js";

export type OnboardingAction = "joined" | "requested" | "already_pending" | "error";

export interface OnboardingResult {
  action: OnboardingAction;
  reply: string;
}

function displayName(openId: string, userName: string | null): string {
  if (userName && userName.trim()) return userName.trim();
  return `用户_${openId.slice(-8)}`;
}

function getFirstAdminOpenId(): string | null {
  const raw = process.env.FEISHU_ADMIN_OPEN_IDS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === "string") return parsed[0];
  } catch {
    // fall through
  }
  return null;
}

async function notifyAdminOfRequest(params: {
  adminOpenId: string;
  senderOpenId: string;
  name: string;
  messageText: string;
}): Promise<void> {
  const lines = [
    "🔔 新用户申请开通 BitWorld",
    `姓名:${params.name}`,
    `open_id:${params.senderOpenId}`,
    `留言:${params.messageText.slice(0, 80)}`,
    "",
    "批准请复制下行发送:",
    `/admin add ${params.senderOpenId} ${params.name}`,
  ];
  await sendDirectMessageToOpenId(params.adminOpenId, lines.join("\n"));
}

/**
 * Handle a message from a non-whitelisted sender. Returns the reply text to
 * send back and the action taken (for logging at the caller).
 */
export async function handleSelfOnboarding(
  db: Db,
  params: { senderOpenId: string; userName: string | null; messageText: string },
): Promise<OnboardingResult> {
  const text = params.messageText.trim();
  const passcode = process.env.FEISHU_JOIN_PASSCODE?.trim();

  // Branch 1: passcode self-serve
  if (passcode && text === passcode) {
    try {
      const name = displayName(params.senderOpenId, params.userName);
      await addToWhitelist(db, params.senderOpenId, "self-onboarding", name);
      logger.info({ senderOpenId: params.senderOpenId }, "[onboarding] passcode accepted, whitelisted");
      return {
        action: "joined",
        reply: "✅ 开通成功!你现在可以直接发送指令使用 BitWorld 了。",
      };
    } catch (err) {
      logger.warn(
        { errMessage: err instanceof Error ? err.message : String(err), senderOpenId: params.senderOpenId },
        "[onboarding] passcode accepted but whitelist insert failed",
      );
      return { action: "error", reply: "❌ 开通处理出错,请稍后重试或联系管理员。" };
    }
  }

  // Branch 2: approval request (idempotent on open_id)
  try {
    const existing = await db
      .select({ id: feishuJoinRequests.id, status: feishuJoinRequests.status })
      .from(feishuJoinRequests)
      .where(eq(feishuJoinRequests.openId, params.senderOpenId))
      .limit(1);

    if (existing.length > 0) {
      logger.info(
        { senderOpenId: params.senderOpenId, status: existing[0].status },
        "[onboarding] duplicate request, not re-notifying",
      );
      return {
        action: "already_pending",
        reply:
          "⏳ 您的申请正在等待管理员批准。\n🔑 如已拿到开通口令,可直接发送口令立即开通,无需等待。",
      };
    }

    const name = displayName(params.senderOpenId, params.userName);
    await db.insert(feishuJoinRequests).values({
      openId: params.senderOpenId,
      userName: params.userName ?? null,
      message: text.slice(0, 200),
      status: "pending",
    });

    const adminOpenId = getFirstAdminOpenId();
    if (adminOpenId) {
      try {
        await notifyAdminOfRequest({
          adminOpenId,
          senderOpenId: params.senderOpenId,
          name,
          messageText: text,
        });
      } catch (notifyErr) {
        logger.warn(
          {
            errMessage: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
            adminOpenId,
            senderOpenId: params.senderOpenId,
          },
          "[onboarding] admin notify failed; request stored, will surface on next admin action",
        );
      }
    } else {
      logger.warn(
        { senderOpenId: params.senderOpenId },
        "[onboarding] no FEISHU_ADMIN_OPEN_IDS configured; request stored without notify",
      );
    }

    return {
      action: "requested",
      reply:
        "👋 欢迎使用 BitWorld 董秘!\n我可为您生成新闻 / 加密 / 科技 / 舆情等领域简报。\n\n🔑 如已有开通口令,请直接发送口令立即使用。\n📨 暂无口令?已为您提交开通申请,管理员批准后即可使用。",
    };
  } catch (err) {
    logger.warn(
      { errMessage: err instanceof Error ? err.message : String(err), senderOpenId: params.senderOpenId },
      "[onboarding] request handling failed",
    );
    return { action: "error", reply: "❌ 申请处理出错,请稍后重试或联系管理员。" };
  }
}
