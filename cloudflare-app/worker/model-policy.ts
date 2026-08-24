export const DEEPSEEK_PRO_MODEL = "deepseek-v4-pro" as const;
export const DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash" as const;

export type DeepSeekModel = typeof DEEPSEEK_PRO_MODEL | typeof DEEPSEEK_FLASH_MODEL;
export type ModelTier = "planning" | "execution";

const planningRolePattern = /CEO|首席|负责人|董事会秘书|主编|策略分析师|新闻分析师|舆情分析师|风险控制|风控|战略|规划|统筹|决策|架构|主管|总监/i;

export function selectAgentModel(input: { name: string; title: string; role?: string }): DeepSeekModel {
  const description = `${input.name} ${input.title} ${input.role ?? ""}`;
  return planningRolePattern.test(description) ? DEEPSEEK_PRO_MODEL : DEEPSEEK_FLASH_MODEL;
}

export function modelTier(model: string): ModelTier {
  return model === DEEPSEEK_PRO_MODEL ? "planning" : "execution";
}

export function modelPolicyLabel(model: string): string {
  return modelTier(model) === "planning" ? "V4 Pro · 统筹规划" : "V4 Flash · 基础执行";
}
