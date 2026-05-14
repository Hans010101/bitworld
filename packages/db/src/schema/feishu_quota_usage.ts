import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Feishu per-sender quota tracking (Phase 6 v12).
 *
 * One row per (sender_open_id, day) for daily command-count + token-used.
 * Pool budget is computed by summing token_used across all rows where
 * day starts with the current YYYY-MM prefix.
 *
 * Per-user-per-day command limit is enforced by counting rows for
 * (sender_open_id, day) and rejecting once command_count reaches
 * FEISHU_DAILY_PER_USER_LIMIT.
 */
export const feishuQuotaUsage = pgTable(
  "feishu_quota_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    senderOpenId: text("sender_open_id").notNull(),
    day: text("day").notNull(), // "YYYY-MM-DD" UTC
    commandCount: integer("command_count").notNull().default(0),
    tokenUsed: integer("token_used").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    senderDayUniqueIdx: uniqueIndex("feishu_quota_sender_day_unique_idx").on(
      table.senderOpenId,
      table.day,
    ),
    dayIdx: index("feishu_quota_day_idx").on(table.day),
  }),
);
