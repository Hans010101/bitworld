import { pgTable, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";

export const sessionMemories = pgTable(
  "session_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").references(() => issues.id),
    taskType: text("task_type"), // 早报/晚报/临时指令/周报
    completed: jsonb("completed").$type<string[]>(), // 完成事项数组
    discoveries: jsonb("discoveries").$type<string[]>(), // 发现数组
    nextAttention: jsonb("next_attention").$type<string[]>(), // 关注项数组
    issuesFound: jsonb("issues_found").$type<string[]>(), // 问题数组
    qualityScore: integer("quality_score"), // 1-10
    qualityNote: text("quality_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentIdx: index("session_memories_agent_idx").on(table.agentId),
    companyIdx: index("session_memories_company_idx").on(table.companyId),
    agentCreatedAtIdx: index("session_memories_agent_created_at_idx").on(
      table.agentId,
      table.createdAt,
    ),
  }),
);
