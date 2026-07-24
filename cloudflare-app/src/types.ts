export type Agent = {
  id: string;
  name: string;
  title: string;
  division: string;
  status: "active" | "working" | "paused" | "error";
  model: string;
  current_task: string | null;
  monthly_input_tokens: number;
  monthly_output_tokens: number;
  monthly_tokens_used: number;
  monthly_neurons_used: number;
  token_period: string;
  last_seen_at: string | null;
  system_prompt: string;
  temperature: number;
  reasoning_mode: "auto" | "high" | "off";
  max_output_tokens: number;
  execution_timeout_sec: number;
  max_retries: number;
  tool_policy: "readonly" | "standard" | "elevated";
  memory_policy: "none" | "task" | "division";
};

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: "owner" | "member";
  status: "active" | "pending" | "disabled";
};

export type AccountUser = AuthUser & {
  createdAt: string;
  lastLoginAt: string | null;
};

export type NotificationProvider = "telegram" | "feishu" | "wecom";

export type NotificationEvent = "task_completed" | "report_published" | "run_failed" | "approval_decided";

export type NotificationChannel = {
  provider: NotificationProvider;
  name: string;
  enabled: boolean;
  configured: boolean;
  configMode: "webhook" | "app" | null;
  inboundConfigured: boolean;
  callbackPath: string | null;
  callbackUrl: string | null;
  events: NotificationEvent[];
  configSummary: string;
  lastTestAt: string | null;
  lastTestStatus: "success" | "failed" | null;
  lastError: string | null;
  updatedAt: string;
};

export type NotificationDelivery = {
  id: string;
  provider: NotificationProvider;
  name: string;
  event_type: NotificationEvent;
  title: string;
  status: "success" | "failed";
  error: string | null;
  created_at: string;
};

export type Task = {
  id: string;
  title: string;
  description: string;
  status: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked";
  priority: "urgent" | "high" | "medium" | "low";
  division: string;
  assignee_agent_id: string | null;
  assignee_name: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  source: "direct" | "secretary" | "schedule";
  workflow_stage: "secretary_intake" | "division_execution" | "division_review" | "secretary_synthesis" | "board_decision" | "archived";
  requested_by: string;
  output_requirements: string;
  final_report_id: string | null;
};

export type Goal = {
  id: string;
  title: string;
  description: string;
  status: string;
  progress: number;
  metric: string;
  current_value: number;
  target_value: number;
  owner: string;
  horizon: string;
};

export type Report = {
  id: string;
  title: string;
  type: string;
  summary: string;
  content: string;
  status: string;
  author: string;
  created_at: string;
  task_id: string | null;
  division: string;
  decision_status: "informational" | "needs_decision" | "approved" | "rejected" | "archived";
  confidence: "low" | "medium" | "high";
  recommendation: string;
};

export type ScheduledTask = {
  id: string;
  title: string;
  description: string;
  division: string;
  assignee_agent_id: string | null;
  assignee_name: string | null;
  frequency: "hourly" | "daily" | "weekdays" | "weekly" | "monthly";
  time_utc: string;
  enabled: boolean;
  priority: Task["priority"];
  output_requirements: string;
  next_run_at: string;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Approval = {
  id: string;
  title: string;
  type: string;
  status: "pending" | "approved" | "rejected";
  risk: "low" | "medium" | "high";
  requested_by: string;
  rationale: string;
  created_at: string;
};

export type Activity = {
  id: string;
  type: string;
  summary: string;
  actor: string;
  created_at: string;
};

export type Run = {
  id: string;
  task_id: string;
  task_title: string;
  agent_id: string;
  agent_name: string;
  status: "queued" | "running" | "succeeded" | "failed";
  model: string;
  provider: "pending" | "deepseek" | "cloudflare";
  neurons_used: number;
  output_excerpt: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  created_at: string;
  finished_at: string | null;
};

export type AiRouting = {
  preferCloudflareFree: boolean;
  cloudflareModel: string;
  dailyNeuronAllocation: number;
  dailyNeuronSoftLimit: number;
  dailyNeuronsUsed: number;
  dailyNeuronsRemaining: number;
  resetAt: string;
  executionRoute: string[];
  planningRoute: string[];
};

export type Dashboard = {
  metrics: {
    activeAgents: number;
    totalAgents: number;
    openTasks: number;
    pendingApprovals: number;
    monthlyTokensUsed: number;
    completedThisWeek: number;
  };
  attention: Task[];
  agents: Agent[];
  reports: Report[];
  runs: Run[];
  activity: Activity[];
};
