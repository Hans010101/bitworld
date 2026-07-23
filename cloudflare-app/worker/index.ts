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

type EmailAuthCodeRow = {
  id: string;
  code_hash: string;
  display_name: string | null;
  attempts: number;
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
  system_prompt: string;
  temperature: number;
  reasoning_mode: string;
  max_output_tokens: number;
  execution_timeout_sec: number;
  max_retries: number;
  tool_policy: string;
  memory_policy: string;
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
  source: string;
  workflow_stage: string;
  requested_by: string;
  output_requirements: string;
  final_report_id: string | null;
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
  source: string;
  output_requirements: string;
  system_prompt: string;
  temperature: number;
  reasoning_mode: string;
  max_output_tokens: number;
  execution_timeout_sec: number;
  max_retries: number;
  tool_policy: string;
  memory_policy: string;
};

type ScheduledTaskRow = {
  id: string;
  title: string;
  description: string;
  division: string;
  assignee_agent_id: string | null;
  assignee_name: string | null;
  frequency: string;
  time_utc: string;
  enabled: number;
  priority: string;
  output_requirements: string;
  next_run_at: string;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
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

function emailAuthConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL && !env.RESEND_API_KEY.startsWith("replace-"));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function numericCode(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return value.toString().padStart(6, "0");
}

async function sendEmailCode(email: string, code: string, purpose: "login" | "register", env: Env): Promise<void> {
  const action = purpose === "register" ? "注册" : "登录";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [email],
      subject: `BitWorld ${action}验证码：${code}`,
      text: `你的 BitWorld ${action}验证码是 ${code}。验证码 10 分钟内有效，请勿转发给他人。`,
      html: `<div style="margin:0;background:#f6f0e7;padding:36px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#33251f"><div style="max-width:520px;margin:auto;background:#fffdf8;border:1px solid #e3d5c5;border-radius:18px;padding:36px"><div style="color:#a63830;font-size:12px;font-weight:700;letter-spacing:.12em">BITWORLD · 账号安全</div><h1 style="font-size:24px;margin:18px 0 8px">${action}验证码</h1><p style="color:#756960;line-height:1.7;margin:0">正在为 <strong>${escapeHtml(email)}</strong> 验证邮箱。</p><div style="font-size:36px;letter-spacing:.22em;font-weight:750;color:#a63830;background:#f8eee7;border-radius:12px;padding:18px 20px;margin:26px 0;text-align:center">${code}</div><p style="color:#756960;line-height:1.7;margin:0">验证码 10 分钟内有效。若非本人操作，请忽略此邮件。</p></div></div>`,
    }),
  });
  if (!response.ok) {
    const payload = await response.json<{ message?: string }>().catch(() => ({} as { message?: string }));
    console.error("Resend email failed", response.status, payload.message ?? "unknown error");
    throw new Error("验证码邮件发送失败，请稍后重试");
  }
}

async function requestEmailCode(request: Request, env: Env): Promise<Response> {
  if (!validOrigin(request)) return error("请求来源无效", 403);
  if (!emailAuthConfigured(env)) return error("邮箱验证码登录尚未配置", 503);
  const body = await bodyObject(request);
  const email = body ? stringField(body, "email", 254)?.toLowerCase() : null;
  const purpose = body?.purpose === "login" || body?.purpose === "register" ? body.purpose : null;
  const displayName = body ? stringField(body, "displayName", 60) : null;
  if (!email || !validEmail(email) || !purpose) return error("请输入有效邮箱");
  if (purpose === "register" && !displayName) return error("请输入姓名");
  const throttle = await rateLimited(request, env);
  if (throttle.limited) return error("尝试次数过多，请 15 分钟后再试", 429);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
  if (purpose === "login" && !existing) return error("该邮箱尚未注册，请先创建账号", 404);
  if (purpose === "register" && existing) return error("该邮箱已注册，请直接登录", 409);
  const recent = await env.DB.prepare(`SELECT COUNT(*) count,MAX(created_at) last_created
    FROM email_auth_codes WHERE email=? AND created_at>datetime('now','-15 minutes')`)
    .bind(email).first<{ count: number; last_created: string | null }>();
  if ((recent?.count ?? 0) >= 3) return error("验证码发送过于频繁，请 15 分钟后再试", 429);
  if (recent?.last_created && Date.now() - new Date(`${recent.last_created}Z`).getTime() < 60_000) {
    return error("请等待 60 秒后再重新发送", 429);
  }
  const id = crypto.randomUUID();
  const code = numericCode();
  const codeHash = bytesToBase64Url(await digest(`${code}:${env.SESSION_SECRET}`));
  await env.DB.batch([
    env.DB.prepare("UPDATE email_auth_codes SET consumed_at=CURRENT_TIMESTAMP WHERE email=? AND purpose=? AND consumed_at IS NULL").bind(email, purpose),
    env.DB.prepare(`INSERT INTO email_auth_codes (id,email,code_hash,purpose,display_name,expires_at)
      VALUES (?,?,?,?,?,datetime('now','+10 minutes'))`).bind(id, email, codeHash, purpose, displayName),
  ]);
  try {
    await sendEmailCode(email, code, purpose, env);
  } catch (caught) {
    await env.DB.prepare("DELETE FROM email_auth_codes WHERE id=?").bind(id).run();
    return error(caught instanceof Error ? caught.message : "验证码邮件发送失败", 502);
  }
  return json({ ok: true, message: "验证码已发送，有效期 10 分钟" });
}

async function verifyEmailCode(request: Request, env: Env): Promise<Response> {
  if (!validOrigin(request)) return error("请求来源无效", 403);
  if (!emailAuthConfigured(env)) return error("邮箱验证码登录尚未配置", 503);
  const body = await bodyObject(request);
  const email = body ? stringField(body, "email", 254)?.toLowerCase() : null;
  const code = body ? stringField(body, "code", 6) : null;
  const purpose = body?.purpose === "login" || body?.purpose === "register" ? body.purpose : null;
  if (!email || !validEmail(email) || !code || !/^\d{6}$/.test(code) || !purpose) return error("请输入 6 位邮箱验证码");
  const throttle = await rateLimited(request, env);
  if (throttle.limited) return error("尝试次数过多，请 15 分钟后再试", 429);
  const saved = await env.DB.prepare(`SELECT id,code_hash,display_name,attempts FROM email_auth_codes
    WHERE email=? AND purpose=? AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP
    ORDER BY created_at DESC LIMIT 1`).bind(email, purpose).first<EmailAuthCodeRow>();
  if (!saved || saved.attempts >= 5) return error("验证码已过期，请重新获取", 401);
  const actualHash = await digest(`${code}:${env.SESSION_SECRET}`);
  if (!constantTimeEqual(actualHash, base64UrlToBytes(saved.code_hash))) {
    await env.DB.batch([
      env.DB.prepare("UPDATE email_auth_codes SET attempts=attempts+1 WHERE id=?").bind(saved.id),
      env.DB.prepare("INSERT INTO auth_attempts (ip_hash) VALUES (?)").bind(throttle.ipHash),
    ]);
    return error("验证码不正确", 401);
  }
  let user = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first<UserRow>();
  if (purpose === "register") {
    if (user) return error("该邮箱已注册，请直接登录", 409);
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO users (id,email,display_name,role,status)
      VALUES (?,?,?,CASE WHEN NOT EXISTS(SELECT 1 FROM users) THEN 'owner' ELSE 'member' END,CASE WHEN NOT EXISTS(SELECT 1 FROM users) THEN 'active' ELSE 'pending' END)`)
      .bind(id, email, saved.display_name ?? email.split("@")[0]).run();
    user = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(id).first<UserRow>();
  }
  if (!user) return error("账号不存在，请先创建账号", 404);
  await env.DB.batch([
    env.DB.prepare("UPDATE email_auth_codes SET consumed_at=CURRENT_TIMESTAMP WHERE id=?").bind(saved.id),
    env.DB.prepare("DELETE FROM auth_attempts WHERE ip_hash=?").bind(throttle.ipHash),
  ]);
  if (user.status === "pending") return json({ ok: true, pending: true, message: "邮箱验证成功，等待所有者审核后即可登录" }, 202);
  if (user.status !== "active") return error("账号已停用", 403);
  return withSessionCookie(json({ ok: true, pending: false, user: publicUser(user) }), await createUserSession(user.id, env));
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

const agentSelect = `SELECT id,name,title,division,status,model,current_task,monthly_input_tokens,monthly_output_tokens,monthly_tokens_used,token_period,last_seen_at,system_prompt,temperature,reasoning_mode,max_output_tokens,execution_timeout_sec,max_retries,tool_policy,memory_policy FROM agents`;
const taskSelect = `SELECT t.id,t.title,t.description,t.status,t.priority,t.division,t.assignee_agent_id,a.name AS assignee_name,t.due_at,t.created_at,t.updated_at,t.source,t.workflow_stage,t.requested_by,t.output_requirements,t.final_report_id FROM tasks t LEFT JOIN agents a ON a.id=t.assignee_agent_id`;
const runSelect = `SELECT r.id,r.task_id,t.title AS task_title,r.agent_id,a.name AS agent_name,r.status,r.model,r.output_excerpt,r.input_tokens,r.output_tokens,r.total_tokens,r.created_at,r.finished_at FROM runs r JOIN tasks t ON t.id=r.task_id JOIN agents a ON a.id=r.agent_id`;
const scheduleSelect = `SELECT s.id,s.title,s.description,s.division,s.assignee_agent_id,a.name AS assignee_name,s.frequency,s.time_utc,s.enabled,s.priority,s.output_requirements,s.next_run_at,s.last_run_at,s.created_at,s.updated_at FROM scheduled_tasks s LEFT JOIN agents a ON a.id=s.assignee_agent_id`;

async function dashboard(env: Env): Promise<Response> {
  const [agentCounts, taskCounts, approvals, completed, agents, attention, reports, runs, activity] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status IN ('active','working') THEN 1 ELSE 0 END) active, SUM(CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_tokens_used ELSE 0 END) tokens_used FROM agents").first<{ total: number; active: number; tokens_used: number }>(),
    env.DB.prepare("SELECT SUM(CASE WHEN status NOT IN ('done') THEN 1 ELSE 0 END) open FROM tasks").first<{ open: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM approvals WHERE status='pending'").first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM tasks WHERE status='done' AND updated_at > datetime('now','-7 days')").first<{ count: number }>(),
    env.DB.prepare(`${agentSelect} ORDER BY CASE status WHEN 'working' THEN 0 WHEN 'active' THEN 1 WHEN 'error' THEN 2 ELSE 3 END, name LIMIT 8`).all<AgentRow>(),
    env.DB.prepare(`${taskSelect} WHERE t.status IN ('blocked','in_review') OR t.priority='urgent' ORDER BY CASE t.priority WHEN 'urgent' THEN 0 ELSE 1 END, t.updated_at DESC LIMIT 6`).all<TaskRow>(),
    env.DB.prepare("SELECT id,title,type,summary,content,status,author,created_at,task_id,division,decision_status,confidence,recommendation FROM reports ORDER BY created_at DESC LIMIT 4").all(),
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
  const sources = ["direct", "secretary", "schedule"];
  const source = typeof body.source === "string" && sources.includes(body.source) ? body.source : "secretary";
  const requestedBy = typeof body.requested_by === "string" && body.requested_by.trim() ? body.requested_by.trim().slice(0, 80) : source === "secretary" ? "HQ-003-董秘" : "你";
  const outputRequirements = typeof body.output_requirements === "string" ? body.output_requirements.trim().slice(0, 3000) : "";
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO tasks (id,title,description,priority,division,assignee_agent_id,source,workflow_stage,requested_by,output_requirements) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id, title, description, priority, division, assignee, source, source === "secretary" ? "division_execution" : "division_execution", requestedBy, outputRequirements),
    env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)").bind(crypto.randomUUID(), "task", `${source === "secretary" ? "董秘派单" : "创建任务"}：${title}`, requestedBy),
  ]);
  const item = await env.DB.prepare(`${taskSelect} WHERE t.id=?`).bind(id).first<TaskRow>();
  return json({ item }, 201);
}

async function updateTask(request: Request, env: Env, id: string, ctx: ExecutionContext): Promise<Response> {
  const body = await bodyObject(request);
  if (!body) return error("请求格式无效");
  const current = await env.DB.prepare("SELECT id,title,status,priority,assignee_agent_id,workflow_stage FROM tasks WHERE id=?").bind(id).first<{ id: string; title: string; status: string; priority: string; assignee_agent_id: string | null; workflow_stage: string }>();
  if (!current) return error("任务不存在", 404);
  const statuses = ["backlog", "todo", "in_progress", "in_review", "done", "blocked"];
  const priorities = ["urgent", "high", "medium", "low"];
  const status = typeof body.status === "string" && statuses.includes(body.status) ? body.status : current.status;
  const priority = typeof body.priority === "string" && priorities.includes(body.priority) ? body.priority : current.priority;
  const assignee = body.assignee_agent_id === null || typeof body.assignee_agent_id === "string" ? body.assignee_agent_id : current.assignee_agent_id;
  const stages = ["secretary_intake", "division_execution", "division_review", "secretary_synthesis", "board_decision", "archived"];
  const inferredStage = status === "done" ? "archived" : status === "in_review" ? "secretary_synthesis" : status === "in_progress" ? "division_execution" : current.workflow_stage;
  const workflowStage = typeof body.workflow_stage === "string" && stages.includes(body.workflow_stage) ? body.workflow_stage : inferredStage;
  await env.DB.batch([
    env.DB.prepare("UPDATE tasks SET status=?,priority=?,assignee_agent_id=?,workflow_stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, priority, assignee, workflowStage, id),
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

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

async function updateAgentRuntime(request: Request, env: Env, id: string): Promise<Response> {
  const body = await bodyObject(request);
  if (!body) return error("请求格式无效");
  const current = await env.DB.prepare(`${agentSelect} WHERE id=?`).bind(id).first<AgentRow>();
  if (!current) return error("Agent 不存在", 404);
  const reasoningModes = ["auto", "high", "off"];
  const toolPolicies = ["readonly", "standard", "elevated"];
  const memoryPolicies = ["none", "task", "division"];
  const systemPrompt = typeof body.system_prompt === "string" ? body.system_prompt.trim().slice(0, 6000) : current.system_prompt;
  const reasoningMode = typeof body.reasoning_mode === "string" && reasoningModes.includes(body.reasoning_mode) ? body.reasoning_mode : current.reasoning_mode;
  const toolPolicy = typeof body.tool_policy === "string" && toolPolicies.includes(body.tool_policy) ? body.tool_policy : current.tool_policy;
  const memoryPolicy = typeof body.memory_policy === "string" && memoryPolicies.includes(body.memory_policy) ? body.memory_policy : current.memory_policy;
  const temperature = boundedNumber(body.temperature, current.temperature, 0, 1.5);
  const maxOutputTokens = Math.round(boundedNumber(body.max_output_tokens, current.max_output_tokens, 256, 8000));
  const timeout = Math.round(boundedNumber(body.execution_timeout_sec, current.execution_timeout_sec, 15, 300));
  const maxRetries = Math.round(boundedNumber(body.max_retries, current.max_retries, 0, 5));
  await env.DB.batch([
    env.DB.prepare("UPDATE agents SET system_prompt=?,temperature=?,reasoning_mode=?,max_output_tokens=?,execution_timeout_sec=?,max_retries=?,tool_policy=?,memory_policy=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(systemPrompt, temperature, reasoningMode, maxOutputTokens, timeout, maxRetries, toolPolicy, memoryPolicy, id),
    env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)")
      .bind(crypto.randomUUID(), "agent", `更新 Agent 运行机制：${current.name}`, "你"),
  ]);
  return json({ item: await env.DB.prepare(`${agentSelect} WHERE id=?`).bind(id).first<AgentRow>() });
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

function nextScheduleAt(frequency: string, from = new Date()): string {
  const next = new Date(from);
  if (frequency === "hourly") next.setUTCHours(next.getUTCHours() + 1);
  else if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else if (frequency === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  else {
    next.setUTCDate(next.getUTCDate() + 1);
    if (frequency === "weekdays") while ([0, 6].includes(next.getUTCDay())) next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString();
}

function scheduleItem(row: ScheduledTaskRow | null): (Omit<ScheduledTaskRow, "enabled"> & { enabled: boolean }) | null {
  return row ? { ...row, enabled: Boolean(row.enabled) } : null;
}

async function createSchedule(request: Request, env: Env): Promise<Response> {
  const body = await bodyObject(request);
  if (!body) return error("请求格式无效");
  const title = stringField(body, "title", 160);
  if (!title) return error("定时任务名称不能为空");
  const frequencies = ["hourly", "daily", "weekdays", "weekly", "monthly"];
  const frequency = typeof body.frequency === "string" && frequencies.includes(body.frequency) ? body.frequency : "daily";
  const timeUtc = typeof body.time_utc === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time_utc) ? body.time_utc : "01:00";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 5000) : "";
  const outputRequirements = typeof body.output_requirements === "string" ? body.output_requirements.trim().slice(0, 3000) : "";
  const division = typeof body.division === "string" && body.division.trim() ? body.division.trim().slice(0, 40) : "总部";
  const assignee = typeof body.assignee_agent_id === "string" ? body.assignee_agent_id : null;
  const priorities = ["urgent", "high", "medium", "low"];
  const priority = typeof body.priority === "string" && priorities.includes(body.priority) ? body.priority : "medium";
  const id = crypto.randomUUID();
  const initial = new Date();
  const [hour, minute] = timeUtc.split(":").map(Number);
  initial.setUTCHours(hour, minute, 0, 0);
  if (initial.getTime() <= Date.now()) initial.setTime(new Date(nextScheduleAt(frequency, initial)).getTime());
  await env.DB.batch([
    env.DB.prepare("INSERT INTO scheduled_tasks (id,title,description,division,assignee_agent_id,frequency,time_utc,enabled,priority,output_requirements,next_run_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, title, description, division, assignee, frequency, timeUtc, 1, priority, outputRequirements, initial.toISOString()),
    env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)").bind(crypto.randomUUID(), "schedule", `新增定时任务：${title}`, "你"),
  ]);
  return json({ item: scheduleItem(await env.DB.prepare(`${scheduleSelect} WHERE s.id=?`).bind(id).first<ScheduledTaskRow>()) }, 201);
}

async function updateSchedule(request: Request, env: Env, id: string): Promise<Response> {
  const body = await bodyObject(request);
  if (!body) return error("请求格式无效");
  const current = await env.DB.prepare(`${scheduleSelect} WHERE s.id=?`).bind(id).first<ScheduledTaskRow>();
  if (!current) return error("定时任务不存在", 404);
  const enabled = typeof body.enabled === "boolean" ? Number(body.enabled) : current.enabled;
  await env.DB.prepare("UPDATE scheduled_tasks SET enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(enabled, id).run();
  return json({ item: scheduleItem(await env.DB.prepare(`${scheduleSelect} WHERE s.id=?`).bind(id).first<ScheduledTaskRow>()) });
}

async function deleteSchedule(env: Env, id: string): Promise<Response> {
  const result = await env.DB.prepare("DELETE FROM scheduled_tasks WHERE id=?").bind(id).run();
  if (!result.meta.changes) return error("定时任务不存在", 404);
  return json({ ok: true });
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
  if (path === "/api/health" && request.method === "GET") return json({ ok: true, service: env.APP_NAME, environment: env.ENVIRONMENT, authVersion: 3 });
  if (path === "/api/auth/session" && request.method === "GET") {
    const user = await sessionUser(request, env);
    return json({ authenticated: Boolean(user), user: user ? publicUser(user) : null, googleConfigured: googleConfigured(env), emailConfigured: emailAuthConfigured(env) });
  }
  if (path === "/api/auth/email/request" && request.method === "POST") return requestEmailCode(request, env);
  if (path === "/api/auth/email/verify" && request.method === "POST") return verifyEmailCode(request, env);
  if (path === "/api/auth/login" && request.method === "POST") return emailLogin(request, env);
  if (path === "/api/auth/admin-login" && request.method === "POST") return sharedAdminLogin(request, env);
  if (path === "/api/auth/register" && request.method === "POST") return error("请使用邮箱验证码创建账号", 410);
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
  if (path === "/api/schedules" && request.method === "GET") {
    const rows = (await env.DB.prepare(`${scheduleSelect} ORDER BY s.enabled DESC,s.next_run_at`).all<ScheduledTaskRow>()).results;
    return json({ items: rows.map((row) => scheduleItem(row)) });
  }
  if (path === "/api/schedules" && request.method === "POST") {
    if (currentUser.role !== "owner") return error("只有所有者可以新增定时任务", 403);
    return createSchedule(request, env);
  }
  if (path === "/api/goals" && request.method === "GET") return json({ items: (await env.DB.prepare("SELECT id,title,description,status,progress,metric,current_value,target_value,owner,horizon FROM goals ORDER BY created_at DESC").all()).results });
  if (path === "/api/reports" && request.method === "GET") return json({ items: (await env.DB.prepare("SELECT id,title,type,summary,content,status,author,created_at,task_id,division,decision_status,confidence,recommendation FROM reports ORDER BY created_at DESC").all()).results });
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
  const agentRuntimeMatch = path.match(/^\/api\/agents\/([^/]+)\/runtime$/);
  if (agentRuntimeMatch && request.method === "PATCH") {
    if (currentUser.role !== "owner") return error("只有所有者可以调整 Agent 运行机制", 403);
    return updateAgentRuntime(request, env, decodeURIComponent(agentRuntimeMatch[1]));
  }
  const scheduleMatch = path.match(/^\/api\/schedules\/([^/]+)$/);
  if (scheduleMatch && request.method === "PATCH") {
    if (currentUser.role !== "owner") return error("只有所有者可以调整定时任务", 403);
    return updateSchedule(request, env, decodeURIComponent(scheduleMatch[1]));
  }
  if (scheduleMatch && request.method === "DELETE") {
    if (currentUser.role !== "owner") return error("只有所有者可以删除定时任务", 403);
    return deleteSchedule(env, decodeURIComponent(scheduleMatch[1]));
  }
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
  const context = await env.DB.prepare(`SELECT r.id run_id,t.id task_id,t.title task_title,t.description task_description,t.source,t.output_requirements,a.id agent_id,a.name agent_name,a.title agent_title,a.division,a.model,a.system_prompt,a.temperature,a.reasoning_mode,a.max_output_tokens,a.execution_timeout_sec,a.max_retries,a.tool_policy,a.memory_policy FROM runs r JOIN tasks t ON t.id=r.task_id JOIN agents a ON a.id=r.agent_id WHERE r.id=?`).bind(message.body.runId).first<RunContext>();
  if (!context) {
    message.ack();
    return;
  }
  await env.DB.prepare("UPDATE runs SET status='running',started_at=CURRENT_TIMESTAMP,error=NULL WHERE id=?").bind(context.run_id).run();
  try {
    const messages = [
      { role: "system" as const, content: `${context.system_prompt ? `${context.system_prompt}\n\n` : ""}你是 BitWorld 的 ${context.agent_title}（${context.agent_name}），隶属${context.division}事业部。你正在承接${context.source === "secretary" || context.source === "schedule" ? "董事会秘书派发" : "总部直接下达"}的经营任务。请用简体中文输出专业、可核验、可直接交付给董秘汇总的成果，固定包含：核心结论、关键依据、风险与不确定性、建议行动、需总部决策。不要虚构外部数据。工具权限：${context.tool_policy}；记忆范围：${context.memory_policy}。` },
      { role: "user" as const, content: `任务：${context.task_title}\n\n背景：${context.task_description || "请基于角色职责给出可直接执行的成果。"}\n\n交付标准：${context.output_requirements || "结论明确，依据与风险可追溯，并给出下一步行动。"}` },
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
          temperature: context.temperature,
          max_tokens: context.max_output_tokens,
          stream: false,
          thinking: { type: context.reasoning_mode === "off" ? "disabled" : context.reasoning_mode === "high" || context.model === DEEPSEEK_PRO_MODEL ? "enabled" : "disabled" },
          ...(context.reasoning_mode === "high" || (context.reasoning_mode === "auto" && context.model === DEEPSEEK_PRO_MODEL) ? { reasoning_effort: "high" } : {}),
        }),
        signal: AbortSignal.timeout(context.execution_timeout_sec * 1000),
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
        temperature: context.temperature,
        max_completion_tokens: context.max_output_tokens,
        reasoning_effort: context.reasoning_mode === "high" ? "high" : "low",
      });
      output = extractWorkersAiText(aiResult) ?? extractModelText(aiResult);
      usage = extractModelUsage(aiResult);
    }
    if (!output) throw new Error("模型未返回有效内容");
    const reportId = crypto.randomUUID();
    const summary = output.replace(/[#*_`>\n]/g, " ").replace(/\s+/g, " ").slice(0, 180);
    const decisionStatus = /无需(?:总部)?决策|不需要(?:总部)?决策|无待决策事项/.test(output) ? "informational" : "needs_decision";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO reports (id,run_id,title,type,summary,content,author,task_id,division,decision_status,confidence,recommendation) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(reportId, context.run_id, context.task_title, context.source === "schedule" ? "定时情报" : "事业部任务成果", summary, output, context.agent_name, context.task_id, context.division, decisionStatus, "medium", summary),
      env.DB.prepare("UPDATE runs SET status='succeeded',model=?,output_excerpt=?,input_tokens=?,output_tokens=?,total_tokens=?,finished_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(usedModel, summary, usage.inputTokens, usage.outputTokens, usage.totalTokens, context.run_id),
      env.DB.prepare("UPDATE tasks SET status='in_review',workflow_stage='secretary_synthesis',final_report_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(reportId, context.task_id),
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
    if (message.attempts <= context.max_retries) message.retry({ delaySeconds: 10 * message.attempts });
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

async function dispatchDueSchedules(env: Env): Promise<number> {
  const due = (await env.DB.prepare(`${scheduleSelect} WHERE s.enabled=1 AND s.next_run_at<=CURRENT_TIMESTAMP ORDER BY s.next_run_at LIMIT 20`).all<ScheduledTaskRow>()).results;
  for (const schedule of due) {
    const taskId = crypto.randomUUID();
    const agent = schedule.assignee_agent_id
      ? await env.DB.prepare("SELECT model FROM agents WHERE id=? AND status<>'paused'").bind(schedule.assignee_agent_id).first<{ model: string }>()
      : null;
    const runId = agent ? crypto.randomUUID() : null;
    const nextRunAt = nextScheduleAt(schedule.frequency, new Date(schedule.next_run_at));
    const statements = [
      env.DB.prepare("INSERT INTO tasks (id,title,description,status,priority,division,assignee_agent_id,source,workflow_stage,requested_by,output_requirements) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(taskId, schedule.title, schedule.description, runId ? "in_progress" : "todo", schedule.priority, schedule.division, schedule.assignee_agent_id, "schedule", "division_execution", "HQ-003-董秘 · 定时调度", schedule.output_requirements),
      env.DB.prepare("UPDATE scheduled_tasks SET last_run_at=CURRENT_TIMESTAMP,next_run_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND next_run_at=?")
        .bind(nextRunAt, schedule.id, schedule.next_run_at),
      env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)")
        .bind(crypto.randomUUID(), "schedule", `定时派单：${schedule.title}`, "HQ-003-董秘"),
    ];
    if (runId && schedule.assignee_agent_id && agent) {
      statements.push(
        env.DB.prepare("INSERT INTO runs (id,task_id,agent_id,model) VALUES (?,?,?,?)").bind(runId, taskId, schedule.assignee_agent_id, agent.model),
        env.DB.prepare("UPDATE agents SET status='working',current_task=?,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(schedule.title, schedule.assignee_agent_id),
      );
      await env.DB.batch(statements);
      await env.TASK_QUEUE.send({ runId } satisfies RunMessage);
      continue;
    }
    await env.DB.batch(statements);
  }
  return due.length;
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
    const dispatched = await dispatchDueSchedules(env);
    console.log(JSON.stringify({ event: "scheduled_dispatch", dispatched }));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM auth_attempts WHERE attempted_at < datetime('now','-1 day')"),
      env.DB.prepare("DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP"),
      env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < CURRENT_TIMESTAMP"),
      env.DB.prepare("DELETE FROM email_auth_codes WHERE expires_at < datetime('now','-1 day') OR consumed_at IS NOT NULL"),
    ]);
  },
} satisfies ExportedHandler<Env, RunMessage>;
