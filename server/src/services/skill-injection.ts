import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../middleware/logger.js";

// Resolve skills dir relative to this source file: server/src/services/ → ../../skills/
const __dir = path.dirname(new URL(import.meta.url).pathname);
const SKILLS_BASE = path.resolve(__dir, "../../../skills");

// Token budget limits (in characters, ~3 chars per token for Chinese)
const BUDGET_COMMON = 2000;
const BUDGET_DEPT = 3000;
const BUDGET_TOTAL = 6000;

// Map agent name prefix to skill directory
const DEPT_MAP: Record<string, string> = {
  "News": "news",
  "Crypto": "crypto",
  "Sentiment": "sentiment",
  "Research": "research",
};

interface SkillFile {
  name: string;
  content: string;
  assignedAgents: string[];
  charCount: number;
}

/**
 * Parse a skill .md file, extracting frontmatter metadata and content body.
 */
async function parseSkillFile(filePath: string): Promise<SkillFile | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    if (!raw.trim()) return null;

    let name = path.basename(filePath, ".md");
    let assignedAgents: string[] = [];
    let body = raw;

    // Parse YAML frontmatter (between --- lines)
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (fmMatch) {
      const fm = fmMatch[1];
      body = fmMatch[2].trim();

      const nameMatch = fm.match(/name:\s*(.+)/);
      if (nameMatch) name = nameMatch[1].trim();

      // Parse assigned_agents array
      const agentsMatch = fm.match(/assigned_agents:\s*\n((?:\s+-\s+.+\n?)+)/);
      if (agentsMatch) {
        assignedAgents = agentsMatch[1]
          .split("\n")
          .map((l) => l.replace(/^\s*-\s*/, "").trim())
          .filter((l) => l.length > 0);
      }
    }

    // Strip the first H1 title (redundant with skill name)
    body = body.replace(/^# .+\n+/, "").trim();

    return {
      name,
      content: body,
      assignedAgents,
      charCount: body.length,
    };
  } catch {
    return null;
  }
}

/**
 * Load all .md skill files from a directory.
 */
async function loadSkillsFromDir(dirPath: string): Promise<SkillFile[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const skills: SkillFile[] = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const skill = await parseSkillFile(path.join(dirPath, entry.name));
        if (skill) skills.push(skill);
      }
    }
    return skills;
  } catch {
    return [];
  }
}

/**
 * Truncate skills to fit within a character budget.
 * Prioritizes skills that match the agent name in assigned_agents.
 */
function applyBudget(skills: SkillFile[], budget: number, agentName: string): SkillFile[] {
  // Sort: assigned skills first, then by length (shorter first to fit more)
  const sorted = [...skills].sort((a, b) => {
    const aAssigned = a.assignedAgents.some((n) => agentName.includes(n)) ? 0 : 1;
    const bAssigned = b.assignedAgents.some((n) => agentName.includes(n)) ? 0 : 1;
    if (aAssigned !== bAssigned) return aAssigned - bAssigned;
    return a.charCount - b.charCount;
  });

  const result: SkillFile[] = [];
  let used = 0;
  for (const skill of sorted) {
    if (used + skill.charCount <= budget) {
      result.push(skill);
      used += skill.charCount;
    } else if (budget - used > 200) {
      // Truncate the last skill to fit
      result.push({
        ...skill,
        content: skill.content.substring(0, budget - used - 50) + "\n\n...(已截断，完整内容见 skills/ 目录)",
        charCount: budget - used,
      });
      break;
    }
  }
  return result;
}

/**
 * Format skills into a prompt section.
 */
function formatSkillsSection(skills: SkillFile[]): string {
  if (skills.length === 0) return "";
  const sections = skills.map((s) => `### ${s.name}\n${s.content}`);
  return `## 工作技能库\n以下是你在执行任务时必须遵循的工作方法论和规范：\n\n${sections.join("\n\n")}`;
}

/**
 * Build the full skills injection text for an agent.
 */
export async function buildSkillsForAgent(agentName: string, issueTitle?: string): Promise<string> {
  try {
    // 1. Load common skills
    const commonSkills = await loadSkillsFromDir(path.join(SKILLS_BASE, "common"));
    const budgetedCommon = applyBudget(commonSkills, BUDGET_COMMON, agentName);

    // 2. Determine department from agent name prefix
    const prefix = Object.keys(DEPT_MAP).find((p) => agentName.startsWith(p));
    let deptSkills: SkillFile[] = [];
    if (prefix) {
      const deptDir = path.join(SKILLS_BASE, DEPT_MAP[prefix]);
      const allDeptSkills = await loadSkillsFromDir(deptDir);

      // Filter by assigned_agents if specified, otherwise include all
      deptSkills = allDeptSkills.filter((s) => {
        if (s.assignedAgents.length === 0) return true;
        return s.assignedAgents.some((a) => agentName.includes(a));
      });

      deptSkills = applyBudget(deptSkills, BUDGET_DEPT, agentName);
    }

    // 3. Combine and apply total budget
    const allSkills = [...budgetedCommon, ...deptSkills];
    let totalChars = allSkills.reduce((sum, s) => sum + s.charCount, 0);

    // If over total budget, trim department skills
    if (totalChars > BUDGET_TOTAL) {
      const commonChars = budgetedCommon.reduce((sum, s) => sum + s.charCount, 0);
      const remainingBudget = BUDGET_TOTAL - commonChars;
      const trimmedDept = applyBudget(deptSkills, remainingBudget, agentName);
      return formatSkillsSection([...budgetedCommon, ...trimmedDept]);
    }

    const result = formatSkillsSection(allSkills);
    logger.info({ agentName, commonCount: budgetedCommon.length, deptCount: deptSkills.length, totalChars, skillsBase: SKILLS_BASE }, "skills injection built");
    return result;
  } catch (err) {
    logger.warn({ err, agentName, skillsBase: SKILLS_BASE }, "failed to build skills for agent");
    return "";
  }
}
