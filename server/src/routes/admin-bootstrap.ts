/**
 * BitWorld Admin Bootstrap Invite Route (token-protected)
 *
 * POST /api/admin/bootstrap-invite
 * Header: X-Bootstrap-Token: <BOOTSTRAP_TOKEN env value>
 * Query (optional):
 *   - force=true        override "admin already exists" check
 *   - expiresHours=N    invite TTL in hours (default 72, max 720)
 *
 * Mirrors `paperclipai auth bootstrap-ceo` for cloud deployments where
 * running the CLI is not feasible. Generates a one-time invite URL for
 * the first instance admin to register via the Better-Auth flow.
 *
 * Reference: cli/src/commands/auth-bootstrap-ceo.ts
 */
import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { instanceUserRoles, invites } from "@paperclipai/db";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { logger } from "../middleware/logger.js";

const FALLBACK_BASE_URL = "https://bitworld-568423242189.asia-northeast1.run.app";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createInviteToken(): string {
  return `pcp_bootstrap_${randomBytes(24).toString("hex")}`;
}

function resolveBaseUrl(): string {
  const fromEnv =
    process.env.PUBLIC_URL ??
    process.env.PAPERCLIP_PUBLIC_URL ??
    process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL ??
    process.env.BETTER_AUTH_URL ??
    process.env.BETTER_AUTH_BASE_URL;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/+$/, "");
  }
  return FALLBACK_BASE_URL;
}

export function adminBootstrapRoutes(db: Db): Router {
  const router = Router();

  router.post("/admin/bootstrap-invite", async (req, res) => {
    const expectedToken = process.env.BOOTSTRAP_TOKEN;
    if (!expectedToken) {
      res.status(503).json({ error: "BOOTSTRAP_TOKEN not configured" });
      return;
    }
    const providedToken = req.header("x-bootstrap-token");
    if (providedToken !== expectedToken) {
      logger.warn({ ip: req.ip }, "[AdminBootstrap] invalid token");
      res.status(401).json({ error: "invalid token" });
      return;
    }

    const force = String(req.query.force ?? "").toLowerCase() === "true";
    const expiresHoursRaw = Number(req.query.expiresHours ?? 72);
    const expiresHours = Math.max(
      1,
      Math.min(24 * 30, Number.isFinite(expiresHoursRaw) ? expiresHoursRaw : 72),
    );

    try {
      const adminCount = await db
        .select({ c: count() })
        .from(instanceUserRoles)
        .where(eq(instanceUserRoles.role, "instance_admin"))
        .then((rows) => Number(rows[0]?.c ?? 0));

      if (adminCount > 0 && !force) {
        res.status(409).json({
          error: "instance already has an admin user",
          hint: "pass ?force=true to issue a new bootstrap invite anyway",
          adminCount,
        });
        return;
      }

      const now = new Date();
      const revokeResult = await db
        .update(invites)
        .set({ revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(invites.inviteType, "bootstrap_ceo"),
            isNull(invites.revokedAt),
            isNull(invites.acceptedAt),
            gt(invites.expiresAt, now),
          ),
        )
        .returning({ id: invites.id });
      const revokedPreviousInvites = revokeResult.length;

      const token = createInviteToken();
      const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000);
      const created = await db
        .insert(invites)
        .values({
          inviteType: "bootstrap_ceo",
          tokenHash: hashToken(token),
          allowedJoinTypes: "human",
          expiresAt,
          invitedByUserId: "system",
        })
        .returning({ id: invites.id, expiresAt: invites.expiresAt })
        .then((rows) => rows[0]);

      const baseUrl = resolveBaseUrl();
      const inviteUrl = `${baseUrl}/invite/${token}`;

      logger.info(
        {
          inviteId: created.id,
          inviteUrl: `${baseUrl}/invite/${token.slice(0, 16)}…`,
          expiresAt: created.expiresAt.toISOString(),
          revokedPreviousInvites,
          forceUsed: force,
          adminCountBefore: adminCount,
        },
        "[AdminBootstrap] bootstrap invite created",
      );

      res.json({
        ok: true,
        inviteUrl,
        expiresAt: created.expiresAt.toISOString(),
        adminCountBefore: adminCount,
        revokedPreviousInvites,
        forceUsed: force,
      });
    } catch (err) {
      logger.error({ err }, "[AdminBootstrap] failed to create bootstrap invite");
      res.status(500).json({ error: String((err as Error)?.message ?? err) });
    }
  });

  return router;
}
