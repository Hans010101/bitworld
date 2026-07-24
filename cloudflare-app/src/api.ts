import type { AccountUser, Activity, Agent, AiRouting, Approval, AuthUser, Dashboard, Goal, NotificationChannel, NotificationDelivery, NotificationEvent, NotificationProvider, Report, Run, ScheduledTask, Task } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
  return payload;
}

export const api = {
  session: () => request<{ authenticated: boolean; user: AuthUser | null; googleConfigured: boolean; emailConfigured: boolean }>("/api/auth/session"),
  requestEmailCode: (email: string, purpose: "login" | "register", displayName?: string) => request<{ ok: boolean; message: string }>("/api/auth/email/request", { method: "POST", body: JSON.stringify({ email, purpose, displayName }) }),
  verifyEmailCode: (email: string, code: string, purpose: "login" | "register") => request<{ ok: boolean; pending: boolean; user?: AuthUser; message?: string }>("/api/auth/email/verify", { method: "POST", body: JSON.stringify({ email, code, purpose }) }),
  login: (email: string, password: string) => request<{ ok: boolean; user: AuthUser }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  adminLogin: (password: string) => request<{ ok: boolean; user: AuthUser }>("/api/auth/admin-login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  users: () => request<{ items: AccountUser[] }>("/api/users"),
  updateUser: (id: string, status: "active" | "disabled") => request<{ ok: boolean }>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  notifications: () => request<{ channels: NotificationChannel[]; deliveries: NotificationDelivery[] }>("/api/notifications"),
  saveNotification: (provider: NotificationProvider, input: { name?: string; enabled: boolean; events: NotificationEvent[]; config?: Record<string, string> }) => request<{ item: NotificationChannel }>(`/api/notifications/${provider}`, { method: "PUT", body: JSON.stringify(input) }),
  testNotification: (provider: NotificationProvider) => request<{ ok: boolean }>(`/api/notifications/${provider}/test`, { method: "POST" }),
  deleteNotification: (provider: NotificationProvider) => request<{ ok: boolean }>(`/api/notifications/${provider}`, { method: "DELETE" }),
  dashboard: () => request<Dashboard>("/api/dashboard"),
  aiRouting: () => request<AiRouting>("/api/ai-routing"),
  updateAiRouting: (preferCloudflareFree: boolean) => request<AiRouting>("/api/ai-routing", { method: "PATCH", body: JSON.stringify({ preferCloudflareFree }) }),
  agents: () => request<{ items: Agent[] }>("/api/agents"),
  createAgent: (input: { name: string; title: string; division: string }) => request<{ item: Agent; modelPolicy: string }>("/api/agents", { method: "POST", body: JSON.stringify(input) }),
  updateAgent: (id: string, status: Agent["status"]) => request<{ item: Agent }>(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  updateAgentRuntime: (id: string, input: Partial<Agent>) => request<{ item: Agent }>(`/api/agents/${id}/runtime`, { method: "PATCH", body: JSON.stringify(input) }),
  tasks: () => request<{ items: Task[] }>("/api/tasks"),
  createTask: (input: Partial<Task>) => request<{ item: Task }>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),
  updateTask: (id: string, input: Partial<Task>) => request<{ item: Task }>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  runTask: (taskId: string, agentId?: string | null) => request<{ runId: string }>("/api/runs", { method: "POST", body: JSON.stringify({ taskId, agentId }) }),
  runs: () => request<{ items: Run[] }>("/api/runs"),
  goals: () => request<{ items: Goal[] }>("/api/goals"),
  reports: () => request<{ items: Report[] }>("/api/reports"),
  schedules: () => request<{ items: ScheduledTask[] }>("/api/schedules"),
  createSchedule: (input: Partial<ScheduledTask>) => request<{ item: ScheduledTask }>("/api/schedules", { method: "POST", body: JSON.stringify(input) }),
  updateSchedule: (id: string, input: Partial<ScheduledTask>) => request<{ item: ScheduledTask }>(`/api/schedules/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteSchedule: (id: string) => request<{ ok: boolean }>(`/api/schedules/${id}`, { method: "DELETE" }),
  approvals: () => request<{ items: Approval[] }>("/api/approvals"),
  decideApproval: (id: string, decision: "approved" | "rejected") => request<{ item: Approval }>(`/api/approvals/${id}`, { method: "PATCH", body: JSON.stringify({ status: decision }) }),
  activity: () => request<{ items: Activity[] }>("/api/activity"),
};
