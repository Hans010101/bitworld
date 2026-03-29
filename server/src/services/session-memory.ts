import { desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { sessionMemories } from "@paperclipai/db";

export interface SessionMemoryData {
  agentId: string;
  companyId: string;
  issueId?: string | null;
  taskType?: string | null;
  completed?: string[];
  discoveries?: string[];
  nextAttention?: string[];
  issuesFound?: string[];
  qualityScore?: number | null;
  qualityNote?: string | null;
}

/**
 * Parse session_summary YAML block from Agent output text.
 * Tolerant parsing — returns partial data if format is imperfect.
 */
export function parseSessionSummary(text: string): Partial<SessionMemoryData> | null {
  // Look for session_summary block: either ---session_summary--- delimiters or YAML key
  const delimitedMatch = text.match(/---session_summary---\s*\n([\s\S]*?)---end_summary---/);
  const yamlMatch = delimitedMatch || text.match(/session_summary:\s*\n([\s\S]*?)(?:\n```|\n---|\n##|\z)/);
  if (!yamlMatch) return null;

  const yamlBlock = yamlMatch[1];
  const result: Partial<SessionMemoryData> = {};

  // Parse simple key-value pairs
  const taskTypeMatch = yamlBlock.match(/task_type:\s*(.+)/);
  if (taskTypeMatch) result.taskType = taskTypeMatch[1].trim().replace(/^["']|["']$/g, "");

  const scoreMatch = yamlBlock.match(/quality_score:\s*(\d+)/);
  if (scoreMatch) result.qualityScore = Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10)));

  const noteMatch = yamlBlock.match(/quality_note:\s*(.+)/);
  if (noteMatch) result.qualityNote = noteMatch[1].trim().replace(/^["']|["']$/g, "");

  // Parse array fields
  const parseArray = (key: string): string[] | undefined => {
    const sectionMatch = yamlBlock.match(new RegExp(`${key}:\\s*\\n((?:\\s+-\\s+.+\\n?)+)`));
    if (!sectionMatch) return undefined;
    return sectionMatch[1]
      .split("\n")
      .map((line) => line.replace(/^\s*-\s*/, "").trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  };

  result.completed = parseArray("completed");
  result.discoveries = parseArray("discoveries");
  result.nextAttention = parseArray("next_attention");
  result.issuesFound = parseArray("issues");

  // Only return if we got at least some useful data
  const hasData =
    result.completed?.length ||
    result.discoveries?.length ||
    result.nextAttention?.length ||
    result.taskType ||
    result.qualityScore;

  return hasData ? result : null;
}

export function sessionMemoryService(db: Db) {
  /**
   * Save a session memory record.
   */
  async function saveMemory(data: SessionMemoryData): Promise<string> {
    const [row] = await db
      .insert(sessionMemories)
      .values({
        agentId: data.agentId,
        companyId: data.companyId,
        issueId: data.issueId ?? null,
        taskType: data.taskType ?? null,
        completed: data.completed ?? null,
        discoveries: data.discoveries ?? null,
        nextAttention: data.nextAttention ?? null,
        issuesFound: data.issuesFound ?? null,
        qualityScore: data.qualityScore ?? null,
        qualityNote: data.qualityNote ?? null,
      })
      .returning({ id: sessionMemories.id });
    return row.id;
  }

  /**
   * Get recent memories for an agent, ordered by most recent first.
   */
  async function getRecentMemories(agentId: string, limit = 3) {
    return db
      .select()
      .from(sessionMemories)
      .where(eq(sessionMemories.agentId, agentId))
      .orderBy(desc(sessionMemories.createdAt))
      .limit(limit);
  }

  /**
   * Format memories into a prompt-injectable text block.
   * Kept concise: ~200 words per memory × 3 = ~600 words total.
   */
  function formatForInjection(
    memories: Awaited<ReturnType<typeof getRecentMemories>>,
  ): string {
    if (memories.length === 0) return "";

    const sections = memories.map((m) => {
      const date = m.createdAt.toISOString().split("T")[0];
      const type = m.taskType || "任务";
      const lines: string[] = [`### ${date} — ${type}`];

      if (m.completed && (m.completed as string[]).length > 0) {
        lines.push(`- 完成: ${(m.completed as string[]).join("；")}`);
      }
      if (m.discoveries && (m.discoveries as string[]).length > 0) {
        lines.push(`- 发现: ${(m.discoveries as string[]).join("；")}`);
      }
      if (m.nextAttention && (m.nextAttention as string[]).length > 0) {
        lines.push(`- 关注: ${(m.nextAttention as string[]).join("；")}`);
      }
      if (m.issuesFound && (m.issuesFound as string[]).length > 0) {
        lines.push(`- 问题: ${(m.issuesFound as string[]).join("；")}`);
      }
      if (m.qualityScore) {
        lines.push(`- 质量自评: ${m.qualityScore}/10${m.qualityNote ? ` (${m.qualityNote})` : ""}`);
      }

      return lines.join("\n");
    });

    return `## 近期工作记忆\n\n${sections.join("\n\n")}`;
  }

  return {
    saveMemory,
    getRecentMemories,
    formatForInjection,
    parseSessionSummary,
  };
}
