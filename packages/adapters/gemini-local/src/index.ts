export const type = "gemini_local";
export const label = "Gemini CLI (local)";
export const DEFAULT_GEMINI_LOCAL_MODEL = "auto";

export const models = [
  { id: DEFAULT_GEMINI_LOCAL_MODEL, label: "Auto" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
];

export const agentConfigurationDoc = `# gemini_local agent configuration

Adapter: gemini_local

Use when:
- You want Paperclip to run the Gemini CLI locally on the host machine
- You want Gemini chat sessions resumed across heartbeats with --resume
- You want Paperclip skills available under the Gemini global skills directory

Don't use when:
- You need webhook-style external invocation (use http or openclaw_gateway)
- You only need a one-shot script without an AI coding agent loop (use process)
- Gemini CLI is not installed on the machine that runs Paperclip

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt
- promptTemplate (string, optional): run prompt template
- model (string, optional): Gemini model id. Defaults to auto.
- yolo (boolean, optional): pass --approval-mode yolo for unattended operation
- command (string, optional): defaults to "gemini"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Runs use positional prompt arguments, not stdin.
- Sessions resume with --resume when stored session cwd matches the current cwd.
- Paperclip auto-injects local skills into "~/.gemini/skills" when missing.
- Authentication can use GEMINI_API_KEY / GOOGLE_API_KEY or local Gemini CLI login.
`;
