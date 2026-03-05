export const type = "cursor";
export const label = "Cursor CLI (local)";
export const DEFAULT_CURSOR_LOCAL_MODEL = "gpt-5";

export const models = [
  { id: DEFAULT_CURSOR_LOCAL_MODEL, label: DEFAULT_CURSOR_LOCAL_MODEL },
  { id: "gpt-5-mini", label: "gpt-5-mini" },
  { id: "sonnet-4", label: "sonnet-4" },
  { id: "sonnet-4-thinking", label: "sonnet-4-thinking" },
];

export const agentConfigurationDoc = `# cursor agent configuration

Adapter: cursor

Use when:
- You want Paperclip to run Cursor Agent CLI locally as the agent runtime
- You want Cursor chat session resume across heartbeats via --resume
- You want structured stream output in run logs via --output-format stream-json

Don't use when:
- You need webhook-style external invocation (use openclaw or http)
- You only need one-shot shell commands (use process)
- Cursor Agent CLI is not installed on the machine

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt
- promptTemplate (string, optional): run prompt template
- model (string, optional): Cursor model id (for example gpt-5)
- mode (string, optional): Cursor execution mode passed as --mode (plan|ask)
- command (string, optional): defaults to "agent"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Runs are executed with: agent -p --output-format stream-json ...
- Prompts are passed as a final positional argument.
- Sessions are resumed with --resume when stored session cwd matches current cwd.
`;
