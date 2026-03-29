import type { ServerAdapterModule } from "../types.js";
import { execute } from "./execute.js";
import { testEnvironment } from "./test.js";

export const openaiCompatibleAdapter: ServerAdapterModule = {
  type: "openai_compatible",
  execute,
  testEnvironment,
  models: [
    { id: "deepseek-chat", label: "DeepSeek V3" },
    { id: "deepseek-reasoner", label: "DeepSeek R1" },
    { id: "qwen3-max", label: "Qwen3 Max" },
    { id: "qwen-plus", label: "Qwen Plus" },
    { id: "moonshot-v1-auto", label: "Kimi (Moonshot)" },
  ],
  agentConfigurationDoc: `# openai_compatible agent configuration

Adapter: openai_compatible

Calls any OpenAI-compatible chat completions API (DeepSeek, Qwen, Kimi, etc.).

Core fields:
- baseUrl (string, required): API base URL (e.g. https://api.deepseek.com/v1)
- apiKey (string, required): Bearer token for authentication
- model (string, required): Model identifier (e.g. deepseek-chat, qwen3-max)

Optional fields:
- temperature (number, optional): Sampling temperature, default 0.7
- maxTokens (number, optional): Max output tokens, default 4096
- timeoutSec (number, optional): Request timeout in seconds, default 300
- systemPrompt (string, optional): Custom system prompt override
- promptTemplate (string, optional): User prompt template with {{variable}} substitution
`,
};
