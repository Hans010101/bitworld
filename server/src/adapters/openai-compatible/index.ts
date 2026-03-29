import type { ServerAdapterModule } from "../types.js";
import { execute } from "./execute.js";
import { testEnvironment } from "./test.js";

export const openaiCompatibleAdapter: ServerAdapterModule = {
  type: "openai_compatible",
  execute,
  testEnvironment,
  models: [
    { id: "deepseek-v3", label: "DeepSeek V3" },
    { id: "deepseek-r1", label: "DeepSeek R1" },
    { id: "qwen3-max", label: "Qwen3 Max" },
    { id: "qwen-plus", label: "Qwen Plus" },
  ],
  agentConfigurationDoc: `# openai_compatible agent configuration

Adapter: openai_compatible

Calls any OpenAI-compatible chat completions API via DashScope (百炼) or others.

Core fields:
- baseUrl (string, required): API base URL (e.g. https://dashscope.aliyuncs.com/compatible-mode/v1)
- apiKey (string, required): Bearer token for authentication
- model (string, required): Model identifier (e.g. deepseek-v3, qwen3-max, deepseek-r1)

Optional fields:
- temperature (number, optional): Sampling temperature, default 0.7
- maxTokens (number, optional): Max output tokens, default 4096
- timeoutSec (number, optional): Request timeout in seconds, default 300
- systemPrompt (string, optional): Custom system prompt override
- promptTemplate (string, optional): User prompt template with {{variable}} substitution
`,
};
