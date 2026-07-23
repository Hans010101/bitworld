export type Agent = {
  id: string;
  name: string;
  title: string;
  division: string;
  status: "active" | "working" | "paused" | "error";
  model: string;
  current_task: string | null;
  monthly_budget: number;
  monthly_spend: number;
  last_seen_at: string | null;
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
  output_excerpt: string | null;
  created_at: string;
  finished_at: string | null;
};

export type Dashboard = {
  metrics: {
    activeAgents: number;
    totalAgents: number;
    openTasks: number;
    pendingApprovals: number;
    monthlySpend: number;
    monthlyBudget: number;
    completedThisWeek: number;
  };
  attention: Task[];
  agents: Agent[];
  reports: Report[];
  runs: Run[];
  activity: Activity[];
};
