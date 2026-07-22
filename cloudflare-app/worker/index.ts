type RunMessage = { runId: string };

type AgentRow = {
  id: string;
  name: string;
  title: string;
  division: string;
  status: string;
  model: string;
  current_task: string | null;
  monthly_budget: number;
  monthly_spend: number;
  last_seen_at: string | null;
};

type TaskRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  division: string;
  assignee_agent_id: string | null;
  assignee_name: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

type RunContext = {
  run_id: string;
  task_id: string;
  task_title: string;
  task_description: string;
  agent_id: string;
  agent_name: string;
  agent_title: string;
  division: string;
  model: string;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: jsonHeaders });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const item of cookie.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left[index] ^ right[index];
  return result === 0;
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

async function createSession(secret: string): Promise<string> {
  const payload = `${Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60}.${crypto.randomUUID()}`;
  return `${payload}.${await sign(payload, secret)}`;
}

async function validSession(request: Request, env: Env): Promise<boolean> {
  const token = cookieValue(request, "bitworld_session");
  if (!token) return false;
  const [expiration, nonce, signature, extra] = token.split(".");
  if (!expiration || !nonce || !signature || extra) return false;
  if (!Number.isFinite(Number(expiration)) || Number(expiration) < Date.now() / 1000) return false;
  const expected = await sign(`${expiration}.${nonce}`, env.SESSION_SECRET);
  return constantTimeEqual(await digest(signature), await digest(expected));
}

function isMutation(request: Request): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(request.method);
}

function validOrigin(request: Request): boolean {
  if (!isMutation(request)) return true;
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}

async function bodyObject(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  try {
    const value: unknown = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringField(body: Record<string, unknown>, key: string, maxLength = 5000): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() && value.length <= maxLength ? value.trim() : null;
}

async function login(request: Request, env: Env): Promise<Response> {
  if (!validOrigin(request)) return error("请求来源无效", 403);
  const body = await bodyObject(request);
  const password = body ? stringField(body, "password", 256) : null;
  if (!password) return error("请输入管理密码");

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const ipHash = bytesToBase64Url(await digest(`${ip}:${env.SESSION_SECRET}`));
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM auth_attempts WHERE ip_hash = ? AND attempted_at > datetime('now','-15 minutes')",
  ).bind(ipHash).first<{ count: number }>();
  if ((recent?.count ?? 0) >= 5) return error("尝试次数过多，请 15 分钟后再试", 429);

  const matches = constantTimeEqual(await digest(password), await digest(env.ADMIN_PASSWORD));
  if (!matches) {
    await env.DB.prepare("INSERT INTO auth_attempts (ip_hash) VALUES (?)").bind(ipHash).run();
    return error("密码错误", 401);
  }

  await env.DB.prepare("DELETE FROM auth_attempts WHERE ip_hash = ?").bind(ipHash).run();
  return json({ ok: true }, 200,);
}

function withSessionCookie(response: Response, value: string): Response {
  const headers = new Headers(response.headers);
  headers.set(
    "set-cookie",
    `bitworld_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`,
  );
  return new Response(response.body, { status: response.status, headers });
}

function clearSession(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("set-cookie", "bitworld_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
  return new Response(response.body, { status: response.status, headers });
}

const agentSelect = `SELECT id,name,title,division,status,model,current_task,monthly_budget,monthly_spend,last_seen_at FROM agents`;
const taskSelect = `SELECT t.id,t.title,t.description,t.status,t.priority,t.division,t.assignee_agent_id,a.name AS assignee_name,t.due_at,t.created_at,t.updated_at FROM tasks t LEFT JOIN agents a ON a.id=t.assignee_agent_id`;
const runSelect = `SELECT r.id,r.task_id,t.title AS task_title,r.agent_id,a.name AS agent_name,r.status,r.model,r.output_excerpt,r.created_at,r.finished_at FROM runs r JOIN tasks t ON t.id=r.task_id JOIN agents a ON a.id=r.agent_id`;

async function dashboard(env: Env): Promise<Response> {
  const [agentCounts, taskCounts, approvals, completed, agents, attention, reports, runs, activity] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status IN ('active','working') THEN 1 ELSE 0 END) active, SUM(monthly_spend) spend, SUM(monthly_budget) budget FROM agents").first<{ total: number; active: number; spend: number; budget: number }>(),
    env.DB.prepare("SELECT SUM(CASE WHEN status NOT IN ('done') THEN 1 ELSE 0 END) open FROM tasks").first<{ open: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM approvals WHERE status='pending'").first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM tasks WHERE status='done' AND updated_at > datetime('now','-7 days')").first<{ count: number }>(),
    env.DB.prepare(`${agentSelect} ORDER BY CASE status WHEN 'working' THEN 0 WHEN 'active' THEN 1 WHEN 'error' THEN 2 ELSE 3 END, name LIMIT 8`).all<AgentRow>(),
    env.DB.prepare(`${taskSelect} WHERE t.status IN ('blocked','in_review') OR t.priority='urgent' ORDER BY CASE t.priority WHEN 'urgent' THEN 0 ELSE 1 END, t.updated_at DESC LIMIT 6`).all<TaskRow>(),
    env.DB.prepare("SELECT id,title,type,summary,content,status,author,created_at FROM reports ORDER BY created_at DESC LIMIT 4").all(),
    env.DB.prepare(`${runSelect} ORDER BY r.created_at DESC LIMIT 5`).all(),
    env.DB.prepare("SELECT id,type,summary,actor,created_at FROM activity ORDER BY created_at DESC LIMIT 8").all(),
  ]);
  return json({
    metrics: {
      activeAgents: agentCounts?.active ?? 0,
      totalAgents: agentCounts?.total ?? 0,
      openTasks: taskCounts?.open ?? 0,
      pendingApprovals: approvals?.count ?? 0,
      monthlySpend: agentCounts?.spend ?? 0,
      monthlyBudget: agentCounts?.budget ?? 0,
      completedThisWeek: completed?.count ?? 0,
    },
    attention: attention.results,
    agents: agents.results,
    reports: reports.results,
    runs: runs.results,
    activity: activity.results,
  });
}

async function createTask(request: Request, env: Env): Promise<Response> {
  const body = await bodyObject(request);
  if (!body) return error("请求格式无效");
  const title = stringField(body, "title", 160);
  if (!title) return error("任务标题不能为空");
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 5000) : "";
  const allowedPriority = ["urgent", "high", "medium", "low"];
  const priority = typeof body.priority === "string" && allowedPriority.includes(body.priority) ? body.priority : "medium";
  const division = typeof body.division === "string" ? body.division.trim().slice(0, 40) : "总部";
  const assignee = typeof body.assignee_agent_id === "string" ? body.assignee_agent_id : null;
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO tasks (id,title,description,priority,division,assignee_agent_id) VALUES (?,?,?,?,?,?)").bind(id, title, description, priority, division, assignee),
    env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)").bind(crypto.randomUUID(), "task", `创建任务：${title}`, "你"),
  ]);
  const item = await env.DB.prepare(`${taskSelect} WHERE t.id=?`).bind(id).first<TaskRow>();
  return json({ item }, 201);
}

async function updateTask(request: Request, env: Env, id: string): Promise<Response> {
  const body = await bodyObject(request);
  if (!body) return error("请求格式无效");
  const current = await env.DB.prepare("SELECT id,title,status,priority,assignee_agent_id FROM tasks WHERE id=?").bind(id).first<{ id: string; title: string; status: string; priority: string; assignee_agent_id: string | null }>();
  if (!current) return error("任务不存在", 404);
  const statuses = ["backlog", "todo", "in_progress", "in_review", "done", "blocked"];
  const priorities = ["urgent", "high", "medium", "low"];
  const status = typeof body.status === "string" && statuses.includes(body.status) ? body.status : current.status;
  const priority = typeof body.priority === "string" && priorities.includes(body.priority) ? body.priority : current.priority;
  const assignee = body.assignee_agent_id === null || typeof body.assignee_agent_id === "string" ? body.assignee_agent_id : current.assignee_agent_id;
  await env.DB.batch([
    env.DB.prepare("UPDATE tasks SET status=?,priority=?,assignee_agent_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, priority, assignee, id),
    env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)").bind(crypto.randomUUID(), "task", `更新任务：${current.title} → ${status}`, "你"),
  ]);
  const item = await env.DB.prepare(`${taskSelect} WHERE t.id=?`).bind(id).first<TaskRow>();
  return json({ item });
}

async function updateAgent(request: Request, env: Env, id: string): Promise<Response> {
  const body = await bodyObject(request);
  const statuses = ["active", "working", "paused", "error"];
  const status = body && typeof body.status === "string" && statuses.includes(body.status) ? body.status : null;
  if (!status) return error("Agent 状态无效");
  const result = await env.DB.prepare("UPDATE agents SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, id).run();
  if (!result.meta.changes) return error("Agent 不存在", 404);
  const item = await env.DB.prepare(`${agentSelect} WHERE id=?`).bind(id).first<AgentRow>();
  return json({ item });
}

async function createRun(request: Request, env: Env): Promise<Response> {
  const body = await bodyObject(request);
  const taskId = body ? stringField(body, "taskId", 100) : null;
  const requestedAgent = body && typeof body.agentId === "string" ? body.agentId : null;
  if (!taskId) return error("请选择任务");
  const task = await env.DB.prepare("SELECT id,title,assignee_agent_id FROM tasks WHERE id=?").bind(taskId).first<{ id: string; title: string; assignee_agent_id: string | null }>();
  if (!task) return error("任务不存在", 404);
  const agentId = requestedAgent ?? task.assignee_agent_id;
  if (!agentId) return error("请先为任务分配 Agent");
  const agent = await env.DB.prepare("SELECT id,name,model,status FROM agents WHERE id=?").bind(agentId).first<{ id: string; name: string; model: string; status: string }>();
  if (!agent) return error("Agent 不存在", 404);
  if (agent.status === "paused") return error("该 Agent 已暂停", 409);
  const runId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO runs (id,task_id,agent_id,model) VALUES (?,?,?,?)").bind(runId, taskId, agentId, agent.model),
    env.DB.prepare("UPDATE tasks SET status='in_progress',assignee_agent_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(agentId, taskId),
    env.DB.prepare("UPDATE agents SET status='working',current_task=?,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(task.title, agentId),
    env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)").bind(crypto.randomUUID(), "run", `开始执行：${task.title}`, agent.name),
  ]);
  await env.TASK_QUEUE.send({ runId } satisfies RunMessage);
  return json({ runId }, 202);
}

async function decideApproval(request: Request, env: Env, id: string): Promise<Response> {
  const body = await bodyObject(request);
  const status = body?.status === "approved" || body?.status === "rejected" ? body.status : null;
  if (!status) return error("审批决定无效");
  const result = await env.DB.prepare("UPDATE approvals SET status=?,decided_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(status, id).run();
  if (!result.meta.changes) return error("审批不存在或已处理", 409);
  const item = await env.DB.prepare("SELECT id,title,type,status,risk,requested_by,rationale,created_at FROM approvals WHERE id=?").bind(id).first();
  await env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)").bind(crypto.randomUUID(), "approval", `${status === "approved" ? "批准" : "拒绝"}：${String(item?.title ?? "审批")}`, "你").run();
  return json({ item });
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/health" && request.method === "GET") return json({ ok: true, service: env.APP_NAME, environment: env.ENVIRONMENT });
  if (path === "/api/auth/session" && request.method === "GET") return json({ authenticated: await validSession(request, env) });
  if (path === "/api/auth/login" && request.method === "POST") {
    const response = await login(request, env);
    if (!response.ok) return response;
    return withSessionCookie(response, await createSession(env.SESSION_SECRET));
  }
  if (path === "/api/auth/logout" && request.method === "POST") {
    if (!validOrigin(request)) return error("请求来源无效", 403);
    return clearSession(json({ ok: true }));
  }
  if (!(await validSession(request, env))) return error("登录已失效", 401);
  if (!validOrigin(request)) return error("请求来源无效", 403);

  if (path === "/api/dashboard" && request.method === "GET") return dashboard(env);
  if (path === "/api/agents" && request.method === "GET") return json({ items: (await env.DB.prepare(`${agentSelect} ORDER BY division,name`).all<AgentRow>()).results });
  if (path === "/api/tasks" && request.method === "GET") return json({ items: (await env.DB.prepare(`${taskSelect} ORDER BY CASE t.status WHEN 'blocked' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'todo' THEN 2 WHEN 'in_review' THEN 3 ELSE 4 END,t.updated_at DESC`).all<TaskRow>()).results });
  if (path === "/api/tasks" && request.method === "POST") return createTask(request, env);
  if (path === "/api/runs" && request.method === "GET") return json({ items: (await env.DB.prepare(`${runSelect} ORDER BY r.created_at DESC LIMIT 30`).all()).results });
  if (path === "/api/runs" && request.method === "POST") return createRun(request, env);
  if (path === "/api/goals" && request.method === "GET") return json({ items: (await env.DB.prepare("SELECT id,title,description,status,progress,metric,current_value,target_value,owner,horizon FROM goals ORDER BY created_at DESC").all()).results });
  if (path === "/api/reports" && request.method === "GET") return json({ items: (await env.DB.prepare("SELECT id,title,type,summary,content,status,author,created_at FROM reports ORDER BY created_at DESC").all()).results });
  if (path === "/api/approvals" && request.method === "GET") return json({ items: (await env.DB.prepare("SELECT id,title,type,status,risk,requested_by,rationale,created_at FROM approvals ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,created_at DESC").all()).results });
  if (path === "/api/activity" && request.method === "GET") return json({ items: (await env.DB.prepare("SELECT id,type,summary,actor,created_at FROM activity ORDER BY created_at DESC LIMIT 50").all()).results });

  const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && request.method === "PATCH") return updateTask(request, env, decodeURIComponent(taskMatch[1]));
  const agentMatch = path.match(/^\/api\/agents\/([^/]+)$/);
  if (agentMatch && request.method === "PATCH") return updateAgent(request, env, decodeURIComponent(agentMatch[1]));
  const approvalMatch = path.match(/^\/api\/approvals\/([^/]+)$/);
  if (approvalMatch && request.method === "PATCH") return decideApproval(request, env, decodeURIComponent(approvalMatch[1]));
  return error("接口不存在", 404);
}

function extractModelText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices.length) return null;
  const choice = choices[0];
  if (typeof choice !== "object" || choice === null) return null;
  const message = (choice as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content.trim() : null;
}

function extractWorkersAiText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const response = (payload as { response?: unknown }).response;
  return typeof response === "string" && response.trim() ? response.trim() : null;
}

async function executeRun(message: Message<RunMessage>, env: Env): Promise<void> {
  const context = await env.DB.prepare(`SELECT r.id run_id,t.id task_id,t.title task_title,t.description task_description,a.id agent_id,a.name agent_name,a.title agent_title,a.division,a.model FROM runs r JOIN tasks t ON t.id=r.task_id JOIN agents a ON a.id=r.agent_id WHERE r.id=?`).bind(message.body.runId).first<RunContext>();
  if (!context) {
    message.ack();
    return;
  }
  await env.DB.prepare("UPDATE runs SET status='running',started_at=CURRENT_TIMESTAMP,error=NULL WHERE id=?").bind(context.run_id).run();
  try {
    const messages = [
      { role: "system" as const, content: `你是 BitWorld 的 ${context.agent_title}（${context.agent_name}），隶属${context.division}事业部。请用中文完成任务，给出结论、依据、风险和下一步行动。输出结构清晰的 Markdown，不虚构外部数据。` },
      { role: "user" as const, content: `任务：${context.task_title}\n\n要求：${context.task_description || "请基于角色职责给出可直接执行的成果。"}` },
    ];
    let output: string | null = null;
    try {
      const response = await fetch(`${env.DASHSCOPE_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.DASHSCOPE_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: context.model, temperature: 0.3, messages }),
      });
      if (!response.ok) throw new Error(`DashScope 返回 ${response.status}`);
      output = extractModelText(await response.json());
    } catch (dashscopeError) {
      console.warn("DashScope unavailable; using Workers AI fallback", dashscopeError);
    }
    if (!output) {
      const aiResult = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
        messages,
        temperature: 0.3,
        max_completion_tokens: 3000,
        reasoning_effort: "low",
      });
      output = extractWorkersAiText(aiResult) ?? extractModelText(aiResult);
    }
    if (!output) throw new Error("模型未返回有效内容");
    const reportId = crypto.randomUUID();
    const summary = output.replace(/[#*_`>\n]/g, " ").replace(/\s+/g, " ").slice(0, 180);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO reports (id,run_id,title,type,summary,content,author) VALUES (?,?,?,?,?,?,?)").bind(reportId, context.run_id, context.task_title, "Agent 任务成果", summary, output, context.agent_name),
      env.DB.prepare("UPDATE runs SET status='succeeded',output_excerpt=?,finished_at=CURRENT_TIMESTAMP WHERE id=?").bind(summary, context.run_id),
      env.DB.prepare("UPDATE tasks SET status='in_review',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(context.task_id),
      env.DB.prepare("UPDATE agents SET status='active',current_task=NULL,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(context.agent_id),
      env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)").bind(crypto.randomUUID(), "report", `已完成：${context.task_title}`, context.agent_name),
    ]);
    message.ack();
  } catch (caught) {
    const messageText = caught instanceof Error ? caught.message : "未知执行错误";
    await env.DB.batch([
      env.DB.prepare("UPDATE runs SET status='failed',error=?,finished_at=CURRENT_TIMESTAMP WHERE id=?").bind(messageText.slice(0, 500), context.run_id),
      env.DB.prepare("UPDATE agents SET status='error',current_task=NULL,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(context.agent_id),
    ]);
    if (message.attempts < 3) message.retry({ delaySeconds: 10 * message.attempts });
    else message.ack();
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env);
    return env.ASSETS.fetch(request);
  },
  async queue(batch: MessageBatch<RunMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) await executeRun(message, env);
  },
  async scheduled(_controller, env): Promise<void> {
    await env.DB.prepare("DELETE FROM auth_attempts WHERE attempted_at < datetime('now','-1 day')").run();
  },
} satisfies ExportedHandler<Env, RunMessage>;
