import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * Feishu ACL tables (Phase 6 v14).
 *
 * Three tables migrate the whitelist/admin model from env-only (v11)
 * to DB-backed dynamic management while keeping env as a seed fallback.
 *
 * - feishuWhitelist:  who can use the bot at all
 * - feishuAdmins:     who can run /admin ... commands (super-admin tier)
 * - feishuSuspensions: temporary user holds (overrides whitelist)
 */

export const feishuWhitelist = pgTable(
  "feishu_whitelist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    openId: text("open_id").notNull(),
    addedBy: text("added_by"), // sender_open_id of admin who added (null = env seed)
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    openIdUniqueIdx: uniqueIndex("feishu_whitelist_open_id_unique_idx").on(t.openId),
  }),
);

export const feishuAdmins = pgTable(
  "feishu_admins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    openId: text("open_id").notNull(),
    grantedBy: text("granted_by"), // null = env seed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    openIdUniqueIdx: uniqueIndex("feishu_admins_open_id_unique_idx").on(t.openId),
  }),
);

export const feishuSuspensions = pgTable(
  "feishu_suspensions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    openId: text("open_id").notNull(),
    until: timestamp("until", { withTimezone: true }).notNull(), // suspension end (exclusive)
    reason: text("reason"),
    suspendedBy: text("suspended_by"), // admin sender_open_id
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    openIdUntilIdx: index("feishu_suspensions_open_id_until_idx").on(t.openId, t.until),
  }),
);

/**
 * Hotfix-v20: pending self-onboarding requests from non-whitelisted senders
 * who did NOT provide the join passcode. Surfaced to admins via direct
 * message so they can /admin add the requester.
 *
 * Idempotent on open_id — a sender's first request is recorded; subsequent
 * messages reuse the same row (no admin re-spam, no DB bloat).
 */
export const feishuJoinRequests = pgTable(
  "feishu_join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    openId: text("open_id").notNull(),
    userName: text("user_name"),
    message: text("message"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    openIdUniqueIdx: uniqueIndex("feishu_join_requests_open_id_unique_idx").on(t.openId),
  }),
);
