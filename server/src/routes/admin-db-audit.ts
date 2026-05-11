/**
 * BitWorld Admin DB Audit Route (token-protected, read-only)
 *
 * POST /api/admin/db-audit
 * Header: X-DB-Audit-Token: <DB_AUDIT_TOKEN env value>
 * Body:   { query: "schema_check" | "migration_status" | "row_counts" | "all" }
 *
 * Cloud-Run-side read-only DB inspection endpoint. Cloud Run can reach
 * Supabase directly (no Web sandbox firewall), so this gives Code a
 * one-curl-away DB audit path without asking Hans to paste SQL.
 *
 * Hard constraints:
 *   - Token-protected (independent DB_AUDIT_TOKEN env)
 *   - Whitelist-only queries (no arbitrary SQL accepted)
 *   - All queries are SELECT / read-only
 */
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { logger } from "../middleware/logger.js";

type AuditQueryKey = "schema_check" | "migration_status" | "row_counts" | "all";

const VALID_QUERIES: AuditQueryKey[] = ["schema_check", "migration_status", "row_counts", "all"];

async function runSchemaCheck(db: Db): Promise<Record<string, unknown>> {
  const existence = (await db.execute(sql`
    SELECT
      EXISTS(SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='session_memories') AS session_memories_exists,
      EXISTS(SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='issues') AS issues_exists,
      EXISTS(SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='agents') AS agents_exists,
      EXISTS(SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='companies') AS companies_exists,
      EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='issues' AND column_name='metadata') AS issues_metadata_column_exists
  `)) as unknown as Array<Record<string, boolean>>;

  const columns = (await db.execute(sql`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN ('session_memories', 'issues')
    ORDER BY table_name, ordinal_position
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    existence: existence[0] ?? null,
    columns,
  };
}

async function runMigrationStatus(db: Db): Promise<Record<string, unknown>> {
  const rows = (await db.execute(sql`
    SELECT id, hash, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY id DESC
    LIMIT 10
  `)) as unknown as Array<Record<string, unknown>>;

  return { recent_migrations: rows };
}

async function runRowCounts(db: Db): Promise<Record<string, unknown>> {
  const rows = (await db.execute(sql`
    SELECT relname AS table_name, n_live_tup::int AS row_count
    FROM pg_stat_user_tables
    WHERE schemaname='public'
    ORDER BY n_live_tup DESC, relname
  `)) as unknown as Array<Record<string, unknown>>;

  return { table_row_counts: rows };
}

export function adminDbAuditRoutes(db: Db): Router {
  const router = Router();

  router.post("/admin/db-audit", async (req, res) => {
    const expectedToken = process.env.DB_AUDIT_TOKEN;
    if (!expectedToken) {
      res.status(503).json({ error: "DB_AUDIT_TOKEN not configured" });
      return;
    }
    const providedToken = req.header("x-db-audit-token");
    if (providedToken !== expectedToken) {
      logger.warn({ ip: req.ip }, "[AdminDbAudit] invalid token");
      res.status(401).json({ error: "invalid token" });
      return;
    }

    const rawQuery = (req.body as { query?: unknown } | undefined)?.query;
    const query = typeof rawQuery === "string" ? rawQuery : "";
    if (!VALID_QUERIES.includes(query as AuditQueryKey)) {
      res.status(400).json({
        error: "invalid query",
        hint: `must be one of: ${VALID_QUERIES.join(", ")}`,
        received: query,
      });
      return;
    }

    try {
      const results: Record<string, unknown> = {};

      if (query === "schema_check" || query === "all") {
        results.schema_check = await runSchemaCheck(db);
      }
      if (query === "migration_status" || query === "all") {
        results.migration_status = await runMigrationStatus(db);
      }
      if (query === "row_counts" || query === "all") {
        results.row_counts = await runRowCounts(db);
      }

      logger.info(
        { query, resultKeys: Object.keys(results) },
        "[AdminDbAudit] audit completed",
      );
      res.json({ ok: true, query, results });
    } catch (err) {
      logger.error({ err, query }, "[AdminDbAudit] audit failed");
      res.status(500).json({ error: String((err as Error)?.message ?? err), query });
    }
  });

  return router;
}
