import {
  deleteNotificationChannel,
  listNotificationSettings,
  notifyEvent,
  saveNotificationChannel,
  testNotificationChannel,
} from "./notifications";
import { DEEPSEEK_PRO_MODEL, modelPolicyLabel, selectAgentModel } from "./model-policy";

type RunMessage = { runId: string };

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  password_salt: string | null;
  password_iterations: number | null;
  google_sub: string | null;
  avatar_url: string | null;
  role: "owner" | "member";
  status: "active" | "pending" | "disabled";
  created_at: string;
};

type AgentRow = {
  id: string;
  name: string;
  title: string;
  division: string;
  status: string;
  model: string;
  current_task: string | null;
  monthly_input_tokens: number;
  monthly_output_tokens: number;
  monthly_tokens_used: number;
  token_period: string;
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
  return (crypto.subtle as SubtleCrypto & { timingSafeEqual(a: BufferSource, b: BufferSource): boolean })
    .timingSafeEqual(new Uint8Array(left).buffer, new Uint8Array(right).buffer);
}

function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

const passwordIterations = 100_000;

async function derivePassword(password: string, salt: Uint8Array, iterations = passwordIterations): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt).buffer, iterations }, material, 256);
  return new Uint8Array(bits);
}

async function sessionUser(request: Request, env: Env): Promise<UserRow | null> {
  const token = cookieValue(request, "bitworld_session");
  if (!token) return null;
  const tokenHash = bytesToBase64Url(await digest(token));
  return env.DB.prepare(`SELECT u.id,u.email,u.display_name,u.password_hash,u.password_salt,u.password_iterations,u.google_sub,u.avatar_url,u.role,u.status,u.created_at
    FROM user_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP AND u.status='active'`)
    .bind(tokenHash).first<UserRow>();
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

async function rateLimited(request: Request, env: Env): Promise<{ limited: boolean; ipHash: string }> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const ipHash = bytesToBase64Url(await digest(`${ip}:${env.SESSION_SECRET}`));
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM auth_attempts WHERE ip_hash=? AND attempted_at>datetime('now','-15 minutes')",
  ).bind(ipHash).first<{ count: number }>();
  return { limited: (recent?.count ?? 0) >= 8, ipHash };
}

async function createUserSession(userId: string, env: Env): Promise<string> {
  const token = randomToken();
  const tokenHash = bytesToBase64Url(await digest(token));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO user_sessions (token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+7 days'))").bind(tokenHash, userId),
    env.DB.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(userId),
  ]);
  return token;
}

async function emailLogin(request: Request, env: Env): Promise<Response> {
  if (!validOrigin(request)) return error("请求来源无效", 403);
  const body = await bodyObject(request);
  const email = body ? stringField(body, "email", 254)?.toLowerCase() : null;
  const password = body ? stringField(body, "password", 256) : null;
  if (!email || !password) return error("请输入邮箱和密码");
  const throttle = await rateLimited(request, env);
  if (throttle.limited) return error("尝试次数过多，请 15 分钟后再试", 429);
  const user = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first<UserRow>();
  let matches = false;
  if (user?.password_hash && user.password_salt && user.password_iterations) {
    const actual = await derivePassword(password, base64UrlToBytes(user.password_salt), user.password_iterations);
    matches = constantTimeEqual(actual, base64UrlToBytes(user.password_hash));
  } else {
    await derivePassword(password, new Uint8Array(16));
  }
  if (!user || !matches) {
    await env.DB.prepare("INSERT INTO auth_attempts (ip_hash) VALUES (?)").bind(throttle.ipHash).run();
    return error("邮箱或密码不正确", 401);
  }
  if (user.status === "pending") return error("账号正在等待所有者审核", 403);
  if (user.status !== "active") return error("账号已停用", 403);
  await env.DB.prepare("DELETE FROM auth_attempts WHERE ip_hash=?").bind(throttle.ipHash).run();
  return withSessionCookie(json({ ok: true, user: publicUser(user) }), await createUserSession(user.id, env));
}

async function sharedAdminLogin(request: Request, env: Env): Promise<Response> {
  if (!validOrigin(request)) return error("请求来源无效", 403);
  const body = await bodyObject(request);
  const password = body ? stringField(body, "password", 256) : null;
  if (!password) return error("请输入备用管理密码");
  const throttle = await rateLimited(request, env);
  if (throttle.limited) return error("尝试次数过多，请 15 分钟后再试", 429);
  const [providedHash, expectedHash] = await Promise.all([digest(password), digest(env.ADMIN_PASSWORD)]);
  if (!constantTimeEqual(providedHash, expectedHash)) {
    await env.DB.prepare("INSERT INTO auth_attempts (ip_hash) VALUES (?)").bind(throttle.ipHash).run();
    return error("备用管理密码不正确", 401);
  }
  const owner = await env.DB.prepare("SELECT * FROM users WHERE role='owner' AND status='active' ORDER BY created_at LIMIT 1").first<UserRow>();
  if (!owner) return error("当前没有可用的所有者账号，请先完成邮箱注册", 409);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_attempts WHERE ip_hash=?").bind(throttle.ipHash),
    env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)")
      .bind(crypto.randomUUID(), "security", "使用备用管理密码登录", owner.display_name),
  ]);
  return withSessionCookie(json({ ok: true, user: publicUser(owner) }), await createUserSession(owner.id, env));
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function register(request: Request, env: Env): Promise<Response> {
  if (!validOrigin(request)) return error("请求来源无效", 403);
  const body = await bodyObject(request);
  const displayName = body ? stringField(body, "displayName", 60) : null;
  const email = body ? stringField(body, "email", 254)?.toLowerCase() : null;
  const password = body ? stringField(body, "password", 256) : null;
  if (!displayName || !email || !validEmail(email) || !password) return error("请完整填写姓名、有效邮箱和密码");
  if (password.length < 10) return error("密码至少需要 10 个字符");
  const throttle = await rateLimited(request, env);
  if (throttle.limited) return error("尝试次数过多，请 15 分钟后再试", 429);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
  if (existing) return error("该邮箱已注册", 409);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await derivePassword(password, salt);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO users (id,email,display_name,password_hash,password_salt,password_iterations,role,status)
    VALUES (?,?,?,?,?,?,CASE WHEN NOT EXISTS(SELECT 1 FROM users) THEN 'owner' ELSE 'member' END,CASE WHEN NOT EXISTS(SELECT 1 FROM users) THEN 'active' ELSE 'pending' END)`)
    .bind(id, email, displayName, bytesToBase64Url(passwordHash), bytesToBase64Url(salt), passwordIterations).run();
  const user = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(id).first<UserRow>();
  if (!user) return error("账号创建失败", 500);
  if (user.status === "pending") return json({ ok: true, pending: true, message: "注册成功，等待所有者审核后即可登录" }, 202);
  return withSessionCookie(json({ ok: true, pending: false, user: publicUser(user) }, 201), await createUserSession(id, env));
}

function publicUser(user: UserRow) {
  return { id: user.id, email: user.email, displayName: user.display_name, avatarUrl: user.avatar_url, role: user.role, status: user.status };
}

function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && !env.GOOGLE_CLIENT_ID.startsWith("replace-"));
}

async function googleStart(request: Request, env: Env): Promise<Response> {
  if (!googleConfigured(env)) return error("Google 登录尚未配置", 503);
  const origin = new URL(request.url).origin;
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = bytesToBase64Url(await digest(verifier));
  await env.DB.prepare("INSERT INTO oauth_states (state_hash,code_verifier,expires_at) VALUES (?,?,datetime('now','+10 minutes'))")
    .bind(bytesToBase64Url(await digest(state)), verifier).run();
  const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  target.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return Response.redirect(target.toString(), 302);
}

async function googleCallback(request: Request, env: Env): Promise<Response> {
  if (!googleConfigured(env)) return error("Google 登录尚未配置", 503);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) return Response.redirect(`${url.origin}/?auth_error=${encodeURIComponent("Google 授权未完成")}`, 302);
  const stateHash = bytesToBase64Url(await digest(state));
  const saved = await env.DB.prepare("SELECT code_verifier FROM oauth_states WHERE state_hash=? AND expires_at>CURRENT_TIMESTAMP")
    .bind(stateHash).first<{ code_verifier: string }>();
  await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash=?").bind(stateHash).run();
  if (!saved) return Response.redirect(`${url.origin}/?auth_error=${encodeURIComponent("登录请求已过期，请重试")}`, 302);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/api/auth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: saved.code_verifier,
    }),
  });
  const tokens = await tokenResponse.json<{ access_token?: string }>();
  if (!tokenResponse.ok || !tokens.access_token) return Response.redirect(`${url.origin}/?auth_error=${encodeURIComponent("Google 登录失败，请重试")}`, 302);
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileResponse.json<{ sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string }>();
  if (!profileResponse.ok || !profile.sub || !profile.email || !profile.email_verified) {
    return Response.redirect(`${url.origin}/?auth_error=${encodeURIComponent("Google 邮箱未通过验证")}`, 302);
  }
  const email = profile.email.toLowerCase();
  let user = await env.DB.prepare("SELECT * FROM users WHERE google_sub=? OR email=?").bind(profile.sub, email).first<UserRow>();
  if (!user) {
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO users (id,email,display_name,google_sub,avatar_url,role,status)
      VALUES (?,?,?,?,?,CASE WHEN NOT EXISTS(SELECT 1 FROM users) THEN 'owner' ELSE 'member' END,CASE WHEN NOT EXISTS(SELECT 1 FROM users) THEN 'active' ELSE 'pending' END)`)
      .bind(id, email, profile.name?.slice(0, 60) || email.split("@")[0], profile.sub, profile.picture || null).run();
    user = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(id).first<UserRow>();
  } else if (!user.google_sub) {
    await env.DB.prepare("UPDATE users SET google_sub=?,avatar_url=COALESCE(avatar_url,?),updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(profile.sub, profile.picture || null, user.id).run();
    user = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(user.id).first<UserRow>();
  }
  if (!user || user.status !== "active") {
    return Response.redirect(`${url.origin}/?auth_notice=${encodeURIComponent("账号已创建，等待所有者审核后即可登录")}`, 302);
  }
  return withSessionCookie(Response.redirect(`${url.origin}/`, 302), await createUserSession(user.id, env));
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

async function logout(request: Request, env: Env): Promise<Response> {
  if (!validOrigin(request)) return error("请求来源无效", 403);
  const token = cookieValue(request, "bitworld_session");
  if (token) await env.DB.prepare("DELETE FROM user_sessions WHERE token_hash=?").bind(bytesToBase64Url(await digest(token))).run();
  return clearSession(json({ ok: true }));
}

const agentSelect = `SELECT id,name,title,division,status,model,current_task,monthly_input_tokens,monthly_output_tokens,monthly_tokens_used,token_period,last_seen_at FROM agents`;
const taskSelect = `SELECT t.id,t.title,t.description,t.status,t.priority,t.division,t.assignee_agent_id,a.name AS assignee_name,t.due_at,t.created_at,t.updated_at FROM tasks t LEFT JOIN agents a ON a.id=t.assignee_agent_id`;
const runSelect = `SELECT r.id,r.task_id,t.title AS task_title,r.agent_id,a.name AS agent_name,r.status,r.model,r.output_excerpt,r.input_tokens,r.output_tokens,r.total_tokens,r.created_at,r.finished_at FROM runs r JOIN tasks t ON t.id=r.task_id JOIN agents a ON a.id=r.agent_id`;

async function dashboard(env: Env): Promise<Response> {
  const [agentCounts, taskCounts, approvals, completed, agents, attention, reports, runs, activity] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status IN ('active','working') THEN 1 ELSE 0 END) active, SUM(CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_tokens_used ELSE 0 END) tokens_used FROM agents").first<{ total: number; active: number; tokens_used: number }>(),
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
      monthlyTokensUsed: agentCounts?.tokens_used ?? 0,
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

async function updateTask(request: Request, env: Env, id: string, ctx: ExecutionContext): Promise<Response> {
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
  if (status === "done" && current.status !== "done") {
    ctx.waitUntil(notifyEvent({
      event: "task_completed",
      title: current.title,
      body: "任务已完成并进入成果归档。",
      detail: item?.assignee_name ? `执行者：${item.assignee_name}` : undefined,
      url: new URL(request.url).origin,
    }, env));
  }
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

async function createAgent(request: Request, env: Env): Promise<Response> {
  const body = await bodyObject(request);
  if (!body) return error("请求格式无效");
  const name = stringField(body, "name", 80);
  const title = stringField(body, "title", 80);
  const division = stringField(body, "division", 40);
  if (!name || !title || !division) return error("请完整填写 Agent 名称、岗位和事业部");
  const role = typeof body.role === "string" && body.role.trim() ? body.role.trim().slice(0, 50) : "custom";
  const model = selectAgentModel({ name, title, role });
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO agents (id,name,title,role,division,model,token_period) VALUES (?,?,?,?,?,?,strftime('%Y-%m','now'))")
      .bind(id, name, title, role, division, model),
    env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)")
      .bind(crypto.randomUUID(), "agent", `新增 Agent：${name} · ${modelPolicyLabel(model)}`, "你"),
  ]);
  const item = await env.DB.prepare(`${agentSelect} WHERE id=?`).bind(id).first<AgentRow>();
  return json({ item, modelPolicy: modelPolicyLabel(model) }, 201);
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

async function decideApproval(request: Request, env: Env, id: string, ctx: ExecutionContext): Promise<Response> {
  const body = await bodyObject(request);
  const status = body?.status === "approved" || body?.status === "rejected" ? body.status : null;
  if (!status) return error("审批决定无效");
  const result = await env.DB.prepare("UPDATE approvals SET status=?,decided_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(status, id).run();
  if (!result.meta.changes) return error("审批不存在或已处理", 409);
  const item = await env.DB.prepare("SELECT id,title,type,status,risk,requested_by,rationale,created_at FROM approvals WHERE id=?").bind(id).first();
  await env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)").bind(crypto.randomUUID(), "approval", `${status === "approved" ? "批准" : "拒绝"}：${String(item?.title ?? "审批")}`, "你").run();
  ctx.waitUntil(notifyEvent({
    event: "approval_decided",
    title: String(item?.title ?? "审批事项"),
    body: status === "approved" ? "审批已通过。" : "审批已拒绝。",
    detail: `申请人：${String(item?.requested_by ?? "未知")}`,
    url: new URL(request.url).origin,
  }, env));
  return json({ item });
}

async function listUsers(env: Env): Promise<Response> {
  const result = await env.DB.prepare("SELECT id,email,display_name,avatar_url,role,status,created_at,last_login_at FROM users ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,created_at DESC").all();
  return json({ items: result.results.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  })) });
}

async function updateUser(request: Request, env: Env, id: string, currentUser: UserRow): Promise<Response> {
  if (currentUser.role !== "owner") return error("只有所有者可以管理账号", 403);
  if (id === currentUser.id) return error("不能在这里修改自己的账号状态", 409);
  const body = await bodyObject(request);
  const status = body?.status === "active" || body?.status === "disabled" ? body.status : null;
  if (!status) return error("账号状态无效");
  const result = await env.DB.prepare("UPDATE users SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND role<>'owner'").bind(status, id).run();
  if (!result.meta.changes) return error("账号不存在或不可修改", 404);
  return json({ ok: true });
}

async function api(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/health" && request.method === "GET") return json({ ok: true, service: env.APP_NAME, environment: env.ENVIRONMENT, authVersion: 2 });
  if (path === "/api/auth/session" && request.method === "GET") {
    const user = await sessionUser(request, env);
    return json({ authenticated: Boolean(user), user: user ? publicUser(user) : null, googleConfigured: googleConfigured(env) });
  }
  if (path === "/api/auth/login" && request.method === "POST") return emailLogin(request, env);
  if (path === "/api/auth/admin-login" && request.method === "POST") return sharedAdminLogin(request, env);
  if (path === "/api/auth/register" && request.method === "POST") return register(request, env);
  if (path === "/api/auth/google/start" && request.method === "GET") return googleStart(request, env);
  if (path === "/api/auth/google/callback" && request.method === "GET") return googleCallback(request, env);
  if (path === "/api/auth/logout" && request.method === "POST") return logout(request, env);
  const currentUser = await sessionUser(request, env);
  if (!currentUser) return error("登录已失效", 401);
  if (!validOrigin(request)) return error("请求来源无效", 403);

  if (path === "/api/dashboard" && request.method === "GET") return dashboard(env);
  if (path === "/api/agents" && request.method === "GET") return json({ items: (await env.DB.prepare(`${agentSelect} ORDER BY division,name`).all<AgentRow>()).results });
  if (path === "/api/agents" && request.method === "POST") {
    if (currentUser.role !== "owner") return error("只有所有者可以新增 Agent", 403);
    return createAgent(request, env);
  }
  if (path === "/api/tasks" && request.method === "GET") return json({ items: (await env.DB.prepare(`${taskSelect} ORDER BY CASE t.status WHEN 'blocked' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'todo' THEN 2 WHEN 'in_review' THEN 3 ELSE 4 END,t.updated_at DESC`).all<TaskRow>()).results });
  if (path === "/api/tasks" && request.method === "POST") return createTask(request, env);
  if (path === "/api/runs" && request.method === "GET") return json({ items: (await env.DB.prepare(`${runSelect} ORDER BY r.created_at DESC LIMIT 30`).all()).results });
  if (path === "/api/runs" && request.method === "POST") return createRun(request, env);
  if (path === "/api/goals" && request.method === "GET") return json({ items: (await env.DB.prepare("SELECT id,title,description,status,progress,metric,current_value,target_value,owner,horizon FROM goals ORDER BY created_at DESC").all()).results });
  if (path === "/api/reports" && request.method === "GET") return json({ items: (await env.DB.prepare("SELECT id,title,type,summary,content,status,author,created_at FROM reports ORDER BY created_at DESC").all()).results });
  if (path === "/api/approvals" && request.method === "GET") return json({ items: (await env.DB.prepare("SELECT id,title,type,status,risk,requested_by,rationale,created_at FROM approvals ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,created_at DESC").all()).results });
  if (path === "/api/activity" && request.method === "GET") return json({ items: (await env.DB.prepare("SELECT id,type,summary,actor,created_at FROM activity ORDER BY created_at DESC LIMIT 50").all()).results });
  if (path === "/api/users" && request.method === "GET") {
    if (currentUser.role !== "owner") return error("只有所有者可以查看账号", 403);
    return listUsers(env);
  }
  if (path === "/api/notifications" && request.method === "GET") {
    if (currentUser.role !== "owner") return error("只有所有者可以管理通知", 403);
    return json(await listNotificationSettings(env));
  }

  const notificationTestMatch = path.match(/^\/api\/notifications\/([^/]+)\/test$/);
  if (notificationTestMatch && request.method === "POST") {
    if (currentUser.role !== "owner") return error("只有所有者可以测试通知", 403);
    try {
      await testNotificationChannel(decodeURIComponent(notificationTestMatch[1]), url.origin, env);
      await env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)")
        .bind(crypto.randomUUID(), "notification", `通知渠道测试成功：${decodeURIComponent(notificationTestMatch[1])}`, currentUser.display_name).run();
      return json({ ok: true });
    } catch (caught) {
      return error(caught instanceof Error ? caught.message : "通知测试失败", 422);
    }
  }

  const notificationMatch = path.match(/^\/api\/notifications\/([^/]+)$/);
  if (notificationMatch && request.method === "PUT") {
    if (currentUser.role !== "owner") return error("只有所有者可以管理通知", 403);
    const body = await bodyObject(request);
    if (!body) return error("请求格式无效");
    try {
      const item = await saveNotificationChannel(decodeURIComponent(notificationMatch[1]), body, env);
      await env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)")
        .bind(crypto.randomUUID(), "notification", `更新通知渠道：${item.name}`, currentUser.display_name).run();
      return json({ item });
    } catch (caught) {
      return error(caught instanceof Error ? caught.message : "通知渠道保存失败", 422);
    }
  }
  if (notificationMatch && request.method === "DELETE") {
    if (currentUser.role !== "owner") return error("只有所有者可以管理通知", 403);
    try {
      await deleteNotificationChannel(decodeURIComponent(notificationMatch[1]), env);
      await env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)")
        .bind(crypto.randomUUID(), "notification", `删除通知渠道：${decodeURIComponent(notificationMatch[1])}`, currentUser.display_name).run();
      return json({ ok: true });
    } catch (caught) {
      return error(caught instanceof Error ? caught.message : "通知渠道删除失败", 422);
    }
  }

  const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && request.method === "PATCH") return updateTask(request, env, decodeURIComponent(taskMatch[1]), ctx);
  const agentMatch = path.match(/^\/api\/agents\/([^/]+)$/);
  if (agentMatch && request.method === "PATCH") return updateAgent(request, env, decodeURIComponent(agentMatch[1]));
  const approvalMatch = path.match(/^\/api\/approvals\/([^/]+)$/);
  if (approvalMatch && request.method === "PATCH") return decideApproval(request, env, decodeURIComponent(approvalMatch[1]), ctx);
  const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && request.method === "PATCH") return updateUser(request, env, decodeURIComponent(userMatch[1]), currentUser);
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

type ModelUsage = { inputTokens: number; outputTokens: number; totalTokens: number };

function extractModelUsage(payload: unknown): ModelUsage {
  if (typeof payload !== "object" || payload === null) return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const usage = (payload as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const values = usage as Record<string, unknown>;
  const tokenValue = (...keys: string[]) => {
    for (const key of keys) {
      const value = values[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
    }
    return 0;
  };
  const inputTokens = tokenValue("prompt_tokens", "input_tokens");
  const outputTokens = tokenValue("completion_tokens", "output_tokens");
  const totalTokens = tokenValue("total_tokens") || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

async function executeRun(message: Message<RunMessage>, env: Env, ctx: ExecutionContext): Promise<void> {
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
    let usedModel = context.model;
    let usage: ModelUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    try {
      const response = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: context.model,
          messages,
          temperature: 0.3,
          max_tokens: 3000,
          stream: false,
          thinking: { type: context.model === DEEPSEEK_PRO_MODEL ? "enabled" : "disabled" },
          ...(context.model === DEEPSEEK_PRO_MODEL ? { reasoning_effort: "high" } : {}),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(payload.error?.message || `DeepSeek 返回 ${response.status}`);
      }
      const payload = await response.json();
      output = extractModelText(payload);
      if (output) usage = extractModelUsage(payload);
    } catch (deepseekError) {
      console.warn("DeepSeek unavailable; using Workers AI fallback", deepseekError);
    }
    if (!output) {
      usedModel = "workers-ai/glm-4.7-flash";
      const aiResult = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
        messages,
        temperature: 0.3,
        max_completion_tokens: 3000,
        reasoning_effort: "low",
      });
      output = extractWorkersAiText(aiResult) ?? extractModelText(aiResult);
      usage = extractModelUsage(aiResult);
    }
    if (!output) throw new Error("模型未返回有效内容");
    const reportId = crypto.randomUUID();
    const summary = output.replace(/[#*_`>\n]/g, " ").replace(/\s+/g, " ").slice(0, 180);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO reports (id,run_id,title,type,summary,content,author) VALUES (?,?,?,?,?,?,?)").bind(reportId, context.run_id, context.task_title, "Agent 任务成果", summary, output, context.agent_name),
      env.DB.prepare("UPDATE runs SET status='succeeded',model=?,output_excerpt=?,input_tokens=?,output_tokens=?,total_tokens=?,finished_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(usedModel, summary, usage.inputTokens, usage.outputTokens, usage.totalTokens, context.run_id),
      env.DB.prepare("UPDATE tasks SET status='in_review',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(context.task_id),
      env.DB.prepare(`UPDATE agents SET
        status='active',
        current_task=NULL,
        monthly_input_tokens=CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_input_tokens+? ELSE ? END,
        monthly_output_tokens=CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_output_tokens+? ELSE ? END,
        monthly_tokens_used=CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_tokens_used+? ELSE ? END,
        token_period=strftime('%Y-%m','now'),
        last_seen_at=CURRENT_TIMESTAMP,
        updated_at=CURRENT_TIMESTAMP
        WHERE id=?`)
        .bind(usage.inputTokens, usage.inputTokens, usage.outputTokens, usage.outputTokens, usage.totalTokens, usage.totalTokens, context.agent_id),
      env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)").bind(crypto.randomUUID(), "report", `已完成：${context.task_title}`, context.agent_name),
    ]);
    ctx.waitUntil(notifyEvent({
      event: "report_published",
      title: context.task_title,
      body: "Agent 已完成执行并发布新报告。",
      detail: `执行者：${context.agent_name}`,
    }, env));
    message.ack();
  } catch (caught) {
    const messageText = caught instanceof Error ? caught.message : "未知执行错误";
    await env.DB.batch([
      env.DB.prepare("UPDATE runs SET status='failed',error=?,finished_at=CURRENT_TIMESTAMP WHERE id=?").bind(messageText.slice(0, 500), context.run_id),
      env.DB.prepare("UPDATE agents SET status='error',current_task=NULL,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(context.agent_id),
    ]);
    if (message.attempts < 3) message.retry({ delaySeconds: 10 * message.attempts });
    else {
      ctx.waitUntil(notifyEvent({
        event: "run_failed",
        title: context.task_title,
        body: "Agent 运行在重试后仍然失败，需要人工处理。",
        detail: `${context.agent_name}：${messageText.slice(0, 240)}`,
      }, env));
      message.ack();
    }
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
  async queue(batch: MessageBatch<RunMessage>, env: Env, ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) await executeRun(message, env, ctx);
  },
  async scheduled(_controller, env): Promise<void> {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM auth_attempts WHERE attempted_at < datetime('now','-1 day')"),
      env.DB.prepare("DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP"),
      env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < CURRENT_TIMESTAMP"),
    ]);
  },
} satisfies ExportedHandler<Env, RunMessage>;
