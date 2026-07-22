import type { Activity, Agent, Approval, Dashboard, Goal, Report, Run, Task } from "./types";

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
  session: () => request<{ authenticated: boolean }>("/api/auth/session"),
  login: (password: string) => request<{ ok: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  dashboard: () => request<Dashboard>("/api/dashboard"),
  agents: () => request<{ items: Agent[] }>("/api/agents"),
  updateAgent: (id: string, status: Agent["status"]) => request<{ item: Agent }>(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  tasks: () => request<{ items: Task[] }>("/api/tasks"),
  createTask: (input: Partial<Task>) => request<{ item: Task }>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),
  updateTask: (id: string, input: Partial<Task>) => request<{ item: Task }>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  runTask: (taskId: string, agentId?: string | null) => request<{ runId: string }>("/api/runs", { method: "POST", body: JSON.stringify({ taskId, agentId }) }),
  runs: () => request<{ items: Run[] }>("/api/runs"),
  goals: () => request<{ items: Goal[] }>("/api/goals"),
  reports: () => request<{ items: Report[] }>("/api/reports"),
  approvals: () => request<{ items: Approval[] }>("/api/approvals"),
  decideApproval: (id: string, decision: "approved" | "rejected") => request<{ item: Approval }>(`/api/approvals/${id}`, { method: "PATCH", body: JSON.stringify({ status: decision }) }),
  activity: () => request<{ items: Activity[] }>("/api/activity"),
};
