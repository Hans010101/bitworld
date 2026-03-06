import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { and, eq, sql } from "drizzle-orm";
import { joinRequests } from "@paperclipai/db";
import { sidebarBadgeService } from "../services/sidebar-badges.js";
import { issueService } from "../services/issues.js";
import { accessService } from "../services/access.js";
import { assertCompanyAccess } from "./authz.js";

const INBOX_ISSUE_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked"] as const;

export function sidebarBadgeRoutes(db: Db) {
  const router = Router();
  const svc = sidebarBadgeService(db);
  const issueSvc = issueService(db);
  const access = accessService(db);

  router.get("/companies/:companyId/sidebar-badges", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    let canApproveJoins = false;
    if (req.actor.type === "board") {
      canApproveJoins =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "joins:approve"));
    } else if (req.actor.type === "agent" && req.actor.agentId) {
      canApproveJoins = await access.hasPermission(companyId, "agent", req.actor.agentId, "joins:approve");
    }

    const joinRequestCount = canApproveJoins
      ? await db
        .select({ count: sql<number>`count(*)` })
        .from(joinRequests)
        .where(and(eq(joinRequests.companyId, companyId), eq(joinRequests.status, "pending_approval")))
        .then((rows) => Number(rows[0]?.count ?? 0))
      : 0;

    const unreadTouchedIssueCount =
      req.actor.type === "board" && req.actor.userId
        ? await issueSvc.countUnreadTouchedByUser(
          companyId,
          req.actor.userId,
          INBOX_ISSUE_STATUSES.join(","),
        )
        : 0;

    const badges = await svc.get(companyId, {
      joinRequests: joinRequestCount,
      unreadTouchedIssues: unreadTouchedIssueCount,
    });
    res.json(badges);
  });

  return router;
}
