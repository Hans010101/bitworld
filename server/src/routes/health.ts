import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import { instanceUserRoles, invites } from "@paperclipai/db";
import type { DeploymentExposure, DeploymentMode } from "@paperclipai/shared";

export function healthRoutes(
  db?: Db,
  opts: {
    deploymentMode: DeploymentMode;
    deploymentExposure: DeploymentExposure;
    authReady: boolean;
    companyDeletionEnabled: boolean;
  } = {
    deploymentMode: "local_trusted",
    deploymentExposure: "private",
    authReady: true,
    companyDeletionEnabled: true,
  },
) {
  const router = Router();

  router.get("/", async (_req, res) => {
    if (!db) {
      res.json({ status: "ok" });
      return;
    }

    // Wrap DB queries with a timeout so health checks never hang
    const DB_TIMEOUT_MS = 5000;
    let bootstrapStatus: "ready" | "bootstrap_pending" = "ready";
    let bootstrapInviteActive = false;
    let dbHealthy = true;

    if (opts.deploymentMode === "authenticated") {
      try {
        const dbQuery = async () => {
          const roleCount = await db
            .select({ count: count() })
            .from(instanceUserRoles)
            .where(sql`${instanceUserRoles.role} = 'instance_admin'`)
            .then((rows) => Number(rows[0]?.count ?? 0));
          bootstrapStatus = roleCount > 0 ? "ready" : "bootstrap_pending";

          if (bootstrapStatus === "bootstrap_pending") {
            const now = new Date();
            const inviteCount = await db
              .select({ count: count() })
              .from(invites)
              .where(
                and(
                  eq(invites.inviteType, "bootstrap_ceo"),
                  isNull(invites.revokedAt),
                  isNull(invites.acceptedAt),
                  gt(invites.expiresAt, now),
                ),
              )
              .then((rows) => Number(rows[0]?.count ?? 0));
            bootstrapInviteActive = inviteCount > 0;
          }
        };

        await Promise.race([
          dbQuery(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("DB health check timeout")), DB_TIMEOUT_MS),
          ),
        ]);
      } catch {
        dbHealthy = false;
      }
    }

    res.json({
      status: dbHealthy ? "ok" : "degraded",
      ...(dbHealthy ? {} : { dbStatus: "timeout" }),
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      authReady: opts.authReady,
      bootstrapStatus,
      bootstrapInviteActive,
      features: {
        companyDeletionEnabled: opts.companyDeletionEnabled,
      },
    });
  });

  return router;
}
