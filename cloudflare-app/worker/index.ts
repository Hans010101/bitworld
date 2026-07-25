import {
  acceptFeishuWebhook,
  acceptTelegramWebhook,
  deleteNotificationChannel,
  type InboundBotMessage,
  listNotificationSettings,
  notifyEvent,
  registerTelegramWebhook,
  saveNotificationChannel,
  sendInboundDocument,
  sendInboundReply,
  testNotificationChannel,
} from "./notifications";
import { DEEPSEEK_PRO_MODEL, modelPolicyLabel, selectAgentModel } from "./model-policy";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { collectLatestResearch, researchPrompt, type ResearchBundle, type ResearchSource } from "./research";
import { generateReportPdf } from "./report-pdf";

type RunMessage = { kind?: "run"; runId: string };
type BotReplyMessage = { kind: "bot_reply"; messageId: string };
type QueueMessage = RunMessage | BotReplyMessage;
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

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
  monthly_neurons_used: number;
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

type AiRoutingRow = {
  id: string;
  prefer_cloudflare_free: number;
  cloudflare_model: string;
  daily_neuron_allocation: number;
  daily_neuron_soft_limit: number;
  updated_at: string;
};

type ModelProvider = "deepseek" | "cloudflare";

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

type BotMessageRow = {
  id: string;
  user_id: string;
  channel_id: string;
  provider: "telegram" | "feishu";
  external_message_id: string;
  conversation_id: string;
  sender_id: string | null;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "processing" | "succeeded" | "failed";
};

type CompanyWorkflowParams = {
  workflowId: string;
  userId: string;
  sourceMessageId: string;
  downloadToken: string;
};

type DivisionExecution = {
  division: string;
  ceoName: string;
  ceoPlan: string;
  contributors: Array<{ agentId: string; agentName: string; title: string; output: string }>;
  integratedOutput: string;
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

const agentSelect = `SELECT id,name,title,division,status,model,current_task,monthly_input_tokens,monthly_output_tokens,monthly_tokens_used,monthly_neurons_used,token_period,last_seen_at,system_prompt,temperature,reasoning_mode,max_output_tokens,execution_timeout_sec,max_retries,tool_policy,memory_policy FROM agents`;
const taskSelect = `SELECT t.id,t.title,t.description,t.status,t.priority,t.division,t.assignee_agent_id,a.name AS assignee_name,t.due_at,t.created_at,t.updated_at,t.source,t.workflow_stage,t.requested_by,t.output_requirements,t.final_report_id,t.company_workflow_id,w.status AS company_workflow_status,w.current_stage AS company_current_stage,w.source_count AS company_source_count FROM tasks t LEFT JOIN agents a ON a.id=t.assignee_agent_id LEFT JOIN company_workflows w ON w.id=t.company_workflow_id`;
const runSelect = `SELECT r.id,r.task_id,t.title AS task_title,r.agent_id,a.name AS agent_name,r.status,r.model,r.provider,r.neurons_used,r.output_excerpt,r.input_tokens,r.output_tokens,r.total_tokens,r.created_at,r.finished_at FROM runs r JOIN tasks t ON t.id=r.task_id JOIN agents a ON a.id=r.agent_id`;
const scheduleSelect = `SELECT s.id,s.title,s.description,s.division,s.assignee_agent_id,a.name AS assignee_name,s.frequency,s.time_utc,s.enabled,s.priority,s.output_requirements,s.next_run_at,s.last_run_at,s.created_at,s.updated_at FROM scheduled_tasks s LEFT JOIN agents a ON a.id=s.assignee_agent_id`;

async function aiRoutingState(env: Env) {
  const [settings, usage] = await Promise.all([
    env.DB.prepare("SELECT * FROM ai_routing_settings WHERE id='default'").first<AiRoutingRow>(),
    env.DB.prepare("SELECT COALESCE(SUM(neurons_used),0) total FROM runs WHERE provider='cloudflare' AND created_at>=date('now')")
      .first<{ total: number }>(),
  ]);
  if (!settings) throw new Error("AI 路由设置不存在，请先执行数据库迁移");
  const dailyNeuronsUsed = Math.round((usage?.total ?? 0) * 100) / 100;
  const resetAt = new Date();
  resetAt.setUTCDate(resetAt.getUTCDate() + 1);
  resetAt.setUTCHours(0, 0, 0, 0);
  const preferCloudflareFree = Boolean(settings.prefer_cloudflare_free);
  return {
    preferCloudflareFree,
    cloudflareModel: settings.cloudflare_model,
    dailyNeuronAllocation: settings.daily_neuron_allocation,
    dailyNeuronSoftLimit: settings.daily_neuron_soft_limit,
    dailyNeuronsUsed,
    dailyNeuronsRemaining: Math.max(0, Math.round((settings.daily_neuron_allocation - dailyNeuronsUsed) * 100) / 100),
    resetAt: resetAt.toISOString(),
    executionRoute: preferCloudflareFree
      ? ["Cloudflare GLM-4.7-Flash", "DeepSeek V4 Flash"]
      : ["DeepSeek V4 Flash", "Cloudflare GLM-4.7-Flash（故障备用）"],
    planningRoute: ["DeepSeek V4 Pro", "Cloudflare GLM-4.7-Flash（故障备用）"],
  };
}

async function updateAiRouting(request: Request, env: Env, currentUser: UserRow): Promise<Response> {
  if (currentUser.role !== "owner") return error("只有所有者可以修改 AI 路由", 403);
  const body = await bodyObject(request);
  if (!body || typeof body.preferCloudflareFree !== "boolean") return error("AI 路由设置无效");
  await env.DB.batch([
    env.DB.prepare("UPDATE ai_routing_settings SET prefer_cloudflare_free=?,updated_at=CURRENT_TIMESTAMP WHERE id='default'")
      .bind(Number(body.preferCloudflareFree)),
    env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)")
      .bind(crypto.randomUUID(), "settings", `${body.preferCloudflareFree ? "开启" : "关闭"} Cloudflare 免费额度优先`, currentUser.display_name),
  ]);
  return json(await aiRoutingState(env));
}

async function dashboard(env: Env): Promise<Response> {
  const [agentCounts, taskCounts, approvals, completed, agents, attention, reports, runs, activity] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status IN ('active','working') THEN 1 ELSE 0 END) active, SUM(CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_tokens_used ELSE 0 END) tokens_used FROM agents").first<{ total: number; active: number; tokens_used: number }>(),
    env.DB.prepare("SELECT SUM(CASE WHEN status NOT IN ('done') THEN 1 ELSE 0 END) open FROM tasks").first<{ open: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM approvals WHERE status='pending'").first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM tasks WHERE status='done' AND updated_at > datetime('now','-7 days')").first<{ count: number }>(),
    env.DB.prepare(`${agentSelect} ORDER BY CASE status WHEN 'working' THEN 0 WHEN 'active' THEN 1 WHEN 'error' THEN 2 ELSE 3 END, name LIMIT 8`).all<AgentRow>(),
    env.DB.prepare(`${taskSelect} WHERE t.status IN ('blocked','in_review') OR t.priority='urgent' ORDER BY CASE t.priority WHEN 'urgent' THEN 0 ELSE 1 END, t.updated_at DESC LIMIT 6`).all<TaskRow>(),
    env.DB.prepare("SELECT id,title,type,summary,content,status,author,created_at,task_id,division,decision_status,confidence,recommendation,workflow_id,pdf_url,source_count,source_cutoff_at FROM reports ORDER BY created_at DESC LIMIT 4").all(),
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
  if (path === "/api/ai-routing" && request.method === "GET") return json(await aiRoutingState(env));
  if (path === "/api/ai-routing" && request.method === "PATCH") return updateAiRouting(request, env, currentUser);
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
  if (path === "/api/reports" && request.method === "GET") return json({ items: (await env.DB.prepare("SELECT id,title,type,summary,content,status,author,created_at,task_id,division,decision_status,confidence,recommendation,workflow_id,pdf_url,source_count,source_cutoff_at FROM reports ORDER BY created_at DESC").all()).results });
  if (path === "/api/approvals" && request.method === "GET") return json({ items: (await env.DB.prepare("SELECT id,title,type,status,risk,requested_by,rationale,created_at FROM approvals ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,created_at DESC").all()).results });
  if (path === "/api/activity" && request.method === "GET") return json({ items: (await env.DB.prepare("SELECT id,type,summary,actor,created_at FROM activity ORDER BY created_at DESC LIMIT 50").all()).results });
  if (path === "/api/users" && request.method === "GET") {
    if (currentUser.role !== "owner") return error("只有所有者可以查看账号", 403);
    return listUsers(env);
  }
  if (path === "/api/notifications" && request.method === "GET") {
    return json(await listNotificationSettings(currentUser.id, env));
  }

  if (path === "/api/notifications/telegram/inbound" && request.method === "POST") {
    try {
      const result = await registerTelegramWebhook(currentUser.id, url.origin, env);
      await env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)")
        .bind(crypto.randomUUID(), "notification", "Telegram 董秘双向回复已启用", currentUser.display_name).run();
      return json(result);
    } catch (caught) {
      return error(caught instanceof Error ? caught.message : "Telegram 双向回复启用失败", 422);
    }
  }

  const notificationTestMatch = path.match(/^\/api\/notifications\/([^/]+)\/test$/);
  if (notificationTestMatch && request.method === "POST") {
    try {
      await testNotificationChannel(decodeURIComponent(notificationTestMatch[1]), url.origin, currentUser.id, env);
      await env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)")
        .bind(crypto.randomUUID(), "notification", `通知渠道测试成功：${decodeURIComponent(notificationTestMatch[1])}`, currentUser.display_name).run();
      return json({ ok: true });
    } catch (caught) {
      return error(caught instanceof Error ? caught.message : "通知测试失败", 422);
    }
  }

  const notificationMatch = path.match(/^\/api\/notifications\/([^/]+)$/);
  if (notificationMatch && request.method === "PUT") {
    const body = await bodyObject(request);
    if (!body) return error("请求格式无效");
    try {
      const item = await saveNotificationChannel(decodeURIComponent(notificationMatch[1]), body, currentUser.id, env);
      await env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)")
        .bind(crypto.randomUUID(), "notification", `更新通知渠道：${item.name}`, currentUser.display_name).run();
      return json({ item });
    } catch (caught) {
      return error(caught instanceof Error ? caught.message : "通知渠道保存失败", 422);
    }
  }
  if (notificationMatch && request.method === "DELETE") {
    try {
      await deleteNotificationChannel(decodeURIComponent(notificationMatch[1]), currentUser.id, env);
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
type ModelResult = {
  output: string;
  model: string;
  provider: ModelProvider;
  usage: ModelUsage;
  neuronsUsed: number;
};

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

function estimatedTokenCount(value: string): number {
  return Math.max(1, Math.ceil(value.length / 2));
}

function normalizedUsage(usage: ModelUsage, messages: Array<{ role: string; content: string }>, output: string): ModelUsage {
  if (usage.totalTokens > 0) return usage;
  const inputTokens = estimatedTokenCount(messages.map((message) => message.content).join("\n"));
  const outputTokens = estimatedTokenCount(output);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function calculateNeurons(usage: ModelUsage): number {
  const neurons = usage.inputTokens * 5_500 / 1_000_000 + usage.outputTokens * 36_400 / 1_000_000;
  return Math.round(neurons * 100) / 100;
}

function completionTokenBudget(context: RunContext): number {
  const thinkingEnabled = context.reasoning_mode !== "off";
  if (!thinkingEnabled) return context.max_output_tokens;
  return Math.min(24_000, Math.max(8_000, context.max_output_tokens * 3));
}

function modelFinishDiagnostic(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "响应不是对象";
  const choice = Array.isArray((payload as { choices?: unknown }).choices)
    ? (payload as { choices: unknown[] }).choices[0]
    : null;
  if (typeof choice !== "object" || choice === null) return "响应没有 choices";
  const finishReason = (choice as { finish_reason?: unknown }).finish_reason;
  const message = (choice as { message?: unknown }).message;
  const reasoningContent = typeof message === "object" && message !== null
    ? (message as { reasoning_content?: unknown }).reasoning_content
    : null;
  const reasoningLength = typeof reasoningContent === "string" ? reasoningContent.length : 0;
  return `finish_reason=${typeof finishReason === "string" ? finishReason : "unknown"}, reasoning_chars=${reasoningLength}`;
}

async function runDeepSeek(
  context: RunContext,
  messages: ChatMessage[],
  env: Env,
): Promise<ModelResult> {
  const thinkingEnabled = context.reasoning_mode !== "off";
  const response = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: context.model,
      messages,
      ...(!thinkingEnabled ? { temperature: context.temperature } : {}),
      max_tokens: completionTokenBudget(context),
      stream: false,
      thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
      ...(thinkingEnabled ? { reasoning_effort: "high" } : {}),
    }),
    signal: AbortSignal.timeout(context.execution_timeout_sec * 1000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(payload.error?.message || `DeepSeek 返回 ${response.status}`);
  }
  const payload = await response.json();
  const output = extractModelText(payload);
  if (!output) throw new Error(`DeepSeek 未返回最终答案（${modelFinishDiagnostic(payload)}）`);
  return {
    output,
    model: context.model,
    provider: "deepseek",
    usage: extractModelUsage(payload),
    neuronsUsed: 0,
  };
}

async function runCloudflare(
  context: RunContext,
  messages: ChatMessage[],
  cloudflareModel: string,
  env: Env,
): Promise<ModelResult> {
  const payload = await env.AI.run(cloudflareModel as Parameters<Env["AI"]["run"]>[0], {
    messages,
    temperature: context.temperature,
    max_completion_tokens: completionTokenBudget(context),
    reasoning_effort: context.reasoning_mode === "high" ? "high" : "low",
  });
  const output = extractWorkersAiText(payload) ?? extractModelText(payload);
  if (!output) throw new Error(`Cloudflare Workers AI 未返回最终答案（${modelFinishDiagnostic(payload)}）`);
  const usage = normalizedUsage(extractModelUsage(payload), messages, output);
  return {
    output,
    model: `workers-ai/${cloudflareModel.split("/").at(-1) ?? "glm-4.7-flash"}`,
    provider: "cloudflare",
    usage,
    neuronsUsed: calculateNeurons(usage),
  };
}

async function executeModelRoute(
  context: RunContext,
  messages: ChatMessage[],
  env: Env,
): Promise<ModelResult> {
  const settings = await aiRoutingState(env);
  const isPlanningAgent = context.model === DEEPSEEK_PRO_MODEL;
  const cloudflareAvailable = settings.dailyNeuronsUsed < settings.dailyNeuronSoftLimit;
  const route: ModelProvider[] = isPlanningAgent
    ? ["deepseek", ...(cloudflareAvailable ? ["cloudflare" as const] : [])]
    : settings.preferCloudflareFree && cloudflareAvailable
      ? ["cloudflare", "deepseek"]
      : ["deepseek", ...(cloudflareAvailable ? ["cloudflare" as const] : [])];
  const failures: string[] = [];
  for (const provider of route) {
    try {
      return provider === "cloudflare"
        ? await runCloudflare(context, messages, settings.cloudflareModel, env)
        : await runDeepSeek(context, messages, env);
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "未知模型错误";
      failures.push(`${provider}: ${reason}`);
      console.warn(JSON.stringify({
        event: "model_route_failed",
        runId: context.run_id,
        provider,
        modelTier: context.model,
        reason: reason.slice(0, 300),
      }));
    }
  }
  throw new Error(`模型路由全部失败：${failures.join("；")}`);
}

function workflowTitle(objective: string): string {
  const firstLine = objective
    .split(/\n|。|！|\?|？/)[0]
    .split(/[，,；;]/)[0]
    .replace(/^(?:(?:最终)?回归(?:测试)?|测试任务|回归任务)\s*[:：]\s*/u, "")
    .replace(/^(?:请\s*)?(?:帮我|给我|麻烦)?\s*/u, "")
    .replace(/^(?:整理|生成|制作|撰写|输出|提供)(?:一份)?\s*/u, "")
    .replace(/最近\s*([0-9]+)\s*小时的?/u, "近$1小时")
    .replace(/的走势分析$/u, "走势分析")
    .trim();
  return (firstLine || "董事会交办事项").slice(0, 80);
}

function routeDivisions(objective: string): string[] {
  const routes: string[] = [];
  const add = (division: string) => {
    if (!routes.includes(division)) routes.push(division);
  };
  if (/BTC|ETH|TRX|SOL|XRP|BNB|比特币|以太坊|波场|加密|数字资产|链上|DeFi|币圈/i.test(objective)) add("加密");
  if (/新闻|快讯|热点|最新|近期|动态|行业情报|舆情事件/i.test(objective)) add("新闻");
  if (/舆情|情绪|口碑|社媒|公众反应|危机传播/i.test(objective)) add("舆情");
  if (/研究|调研|竞品|市场规模|商业模式|方案|战略|产品|用户/i.test(objective)) add("研究");
  if (!routes.length) add("研究");
  return routes.slice(0, 2);
}

function agentContextForWorkflow(
  workflowId: string,
  objective: string,
  agent: AgentRow,
  maxOutputTokens: number,
): RunContext {
  return {
    run_id: `workflow:${workflowId}:${agent.id}`,
    task_id: workflowId,
    task_title: workflowTitle(objective),
    task_description: objective,
    agent_id: agent.id,
    agent_name: agent.name,
    agent_title: agent.title,
    division: agent.division,
    model: agent.model,
    source: "secretary",
    output_requirements: "事实可核验、责任清楚、结论可执行",
    system_prompt: agent.system_prompt,
    temperature: agent.temperature,
    reasoning_mode: agent.reasoning_mode,
    max_output_tokens: Math.min(maxOutputTokens, agent.max_output_tokens),
    execution_timeout_sec: Math.max(60, agent.execution_timeout_sec),
    max_retries: agent.max_retries,
    tool_policy: agent.tool_policy,
    memory_policy: agent.memory_policy,
  };
}

async function recordAgentModelUsage(agent: AgentRow, result: ModelResult, env: Env): Promise<void> {
  const usage = result.usage;
  await env.DB.prepare(`UPDATE agents SET
    monthly_input_tokens=CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_input_tokens+? ELSE ? END,
    monthly_output_tokens=CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_output_tokens+? ELSE ? END,
    monthly_tokens_used=CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_tokens_used+? ELSE ? END,
    monthly_neurons_used=CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_neurons_used+? ELSE ? END,
    token_period=strftime('%Y-%m','now'),last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id=?`)
    .bind(
      usage.inputTokens,
      usage.inputTokens,
      usage.outputTokens,
      usage.outputTokens,
      usage.totalTokens,
      usage.totalTokens,
      result.neuronsUsed,
      result.neuronsUsed,
      agent.id,
    ).run();
}

async function runWorkflowAgent(
  workflowId: string,
  sequence: number,
  stage: string,
  objective: string,
  agent: AgentRow,
  messages: ChatMessage[],
  maxOutputTokens: number,
  sourceIds: string[],
  env: Env,
): Promise<string> {
  const stepId = `${workflowId}:${sequence}`;
  await env.DB.prepare(`INSERT INTO workflow_steps
    (id,workflow_id,sequence,stage,division,agent_id,agent_name,status,input,sources_json,started_at)
    VALUES (?,?,?,?,?,?,?,'running',?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(workflow_id,sequence) DO UPDATE SET
      stage=excluded.stage,division=excluded.division,agent_id=excluded.agent_id,agent_name=excluded.agent_name,
      status='running',input=excluded.input,sources_json=excluded.sources_json,error=NULL,started_at=CURRENT_TIMESTAMP`)
    .bind(
      stepId,
      workflowId,
      sequence,
      stage,
      agent.division,
      agent.id,
      agent.name,
      messages.at(-1)?.content.slice(0, 10_000) ?? "",
      JSON.stringify(sourceIds),
    ).run();
  try {
    const result = await executeModelRoute(agentContextForWorkflow(workflowId, objective, agent, maxOutputTokens), messages, env);
    await env.DB.batch([
      env.DB.prepare(`UPDATE workflow_steps SET
        status='completed',output=?,model=?,provider=?,input_tokens=?,output_tokens=?,total_tokens=?,neurons_used=?,
        finished_at=CURRENT_TIMESTAMP,error=NULL WHERE id=?`)
        .bind(
          result.output,
          result.model,
          result.provider,
          result.usage.inputTokens,
          result.usage.outputTokens,
          result.usage.totalTokens,
          result.neuronsUsed,
          stepId,
        ),
      env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)")
        .bind(crypto.randomUUID(), "workflow", `${stage}：${workflowTitle(objective)}`, agent.name),
    ]);
    await recordAgentModelUsage(agent, result, env);
    return result.output;
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : "未知 Agent 执行错误";
    await env.DB.prepare("UPDATE workflow_steps SET status='failed',error=?,finished_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(reason.slice(0, 500), stepId).run();
    throw caught;
  }
}

function sourceIds(bundle: ResearchBundle): string[] {
  return bundle.sources.map((_source, index) => `S${index + 1}`);
}

async function persistResearch(workflowId: string, bundle: ResearchBundle, env: Env): Promise<void> {
  const statements = bundle.sources.map((source, index) => env.DB.prepare(`INSERT OR REPLACE INTO research_sources
    (id,workflow_id,kind,publisher,title,url,published_at,fetched_at,snippet,raw_data)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      `${workflowId}:source:${index + 1}`,
      workflowId,
      source.kind,
      source.publisher,
      source.title,
      source.url,
      source.publishedAt,
      source.fetchedAt,
      source.snippet,
      source.rawData,
    ));
  if (statements.length) await env.DB.batch(statements);
  await env.DB.prepare(`UPDATE company_workflows SET
    status='researching',current_stage='realtime_research',source_count=?,source_cutoff_at=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=?`).bind(bundle.sources.length, bundle.fetchedAt, workflowId).run();
}

function parseSecretaryDelivery(output: string): { summary: string; report: string } {
  const summaryMatch = output.match(/<USER_SUMMARY>\s*([\s\S]*?)\s*<\/USER_SUMMARY>/i);
  const reportMatch = output.match(/<REPORT>\s*([\s\S]*?)\s*<\/REPORT>/i);
  if (!summaryMatch?.[1] || !reportMatch?.[1]) {
    throw new Error("终稿未按“用户摘要 + 正式报告”双成果格式输出");
  }
  const summary = summaryMatch[1].trim();
  const report = reportMatch[1].trim();
  if (summary.length < 80 || summary.length > 1200) throw new Error("用户摘要长度不符合交付要求");
  if (report.length < 800) throw new Error("正式报告内容过短，未达到专业研究报告要求");
  const internalProcessPatterns = [
    /工作流编号/,
    /责任链/,
    /执行链路/,
    /实际执行清单/,
    /集团\s*CEO\s*统筹/i,
    /事业部\s*CEO/i,
    /职能\s*Agent/i,
    /董事会秘书|董秘/,
    /内部编号/,
  ];
  const leaked = internalProcessPatterns.find((pattern) => pattern.test(summary) || pattern.test(report));
  if (leaked) throw new Error(`终稿泄露内部执行信息：${leaked.source}`);
  return { summary, report };
}

function workflowSourceRows(bundle: ResearchBundle): ResearchSource[] {
  return bundle.sources.map((source) => ({ ...source, rawData: "{}" }));
}

function escapedPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureDivisionPlanCoverage(plan: string, contributors: AgentRow[]): string {
  const missing = contributors.filter((agent) => !plan.includes(agent.name));
  if (!missing.length) return plan;
  return [
    plan,
    "",
    "## 系统补全的必执行职能",
    ...missing.map((agent) => (
      `- ${agent.name}（${agent.title}）：围绕董事会原始任务，从本岗位专属职责出发形成“本职能结论、证据、限制、建议”四段式成果；外部事实必须引用已提供的 [S编号]，不得补写未经核验的最新信息。`
    )),
  ].join("\n");
}

function validateFinalReport(
  report: string,
  objective: string,
  research: ResearchBundle,
  executions: DivisionExecution[],
): void {
  if (!report.includes("[S1]")) throw new Error("终稿没有保留可核验来源编号");
  const allowedYears = new Set(
    [objective, researchPrompt(research)]
      .flatMap((value) => value.match(/\b20\d{2}\b/g) ?? []),
  );
  const unsupportedYears = [...new Set(report.match(/\b20\d{2}\b/g) ?? [])]
    .filter((year) => !allowedYears.has(year));
  if (unsupportedYears.length) {
    throw new Error(`终稿出现任务与证据均未提供的年份：${unsupportedYears.join("、")}`);
  }
  const longestVerifiedDays = Math.max(
    0,
    ...research.sources.flatMap((source) => (
      [...`${source.title} ${source.snippet}`.matchAll(/(?:近\s*)?(\d+)\s*日/g)]
        .map((match) => Number(match[1]))
    )),
  );
  if (longestVerifiedDays > 0) {
    const unsupportedWindow = [...report.matchAll(/(\d+)\s*(?:日|天)(?:窗口|周期|趋势|历史|行情)/g)]
      .map((match) => Number(match[1]))
      .find((days) => days > longestVerifiedDays);
    if (unsupportedWindow) throw new Error(`终稿声称 ${unsupportedWindow} 日分析窗口，但证据最长仅覆盖 ${longestVerifiedDays} 日`);
  }
  const sourceDecimals = research.sources.flatMap((source) => (
    [...source.snippet.matchAll(/\b0\.\d+\b/g)].map((match) => Number(match[0]))
  ));
  const unsupportedPrice = [...report.matchAll(/\b0\.(\d+)\b/g)]
    .map((match) => ({ raw: match[0], value: Number(match[0]), decimals: match[1].length }))
    .find(({ value, decimals }) => !sourceDecimals.some((sourceValue) => (
      Math.abs(value - sourceValue) <= Math.max(0.5 * 10 ** -decimals + Number.EPSILON, sourceValue * 0.001)
    )));
  if (unsupportedPrice) {
    throw new Error(`终稿出现无法由来源数值支持的价格或比率：${unsupportedPrice.raw}`);
  }
  const participantContradictions = executions.flatMap((execution) => execution.contributors.flatMap((agent) => {
    const name = escapedPattern(agent.agentName);
    const contradiction = new RegExp(
      `(?:${name}[^。；\\n]{0,40}(?:未参与|未能履职|缺席|遗漏)|(?:未参与|未能履职|缺席|遗漏)[^。；\\n]{0,40}${name})`,
    );
    return contradiction.test(report) ? [agent.agentName] : [];
  }));
  if (participantContradictions.length) {
    throw new Error(`终稿与实际执行记录冲突：${participantContradictions.join("、")} 已完成任务却被写成未参与`);
  }
  if (/历史高位|历史新高/.test(report) && !research.sources.some((source) => /历史高位|历史新高/.test(source.snippet))) {
    throw new Error("终稿把区间高点误写成历史高位");
  }
  if (/作为(?:一个)?\s*(?:AI|人工智能)/i.test(report)) throw new Error("终稿包含不应出现的 AI 身份表述");
}

export class CompanyWorkflow extends WorkflowEntrypoint<Env, CompanyWorkflowParams> {
  async run(event: WorkflowEvent<CompanyWorkflowParams>, step: WorkflowStep): Promise<void> {
    const params = event.payload;
    try {
      const intake = await step.do("01 董秘受理", async () => {
        const workflow = await this.env.DB.prepare(`SELECT w.objective,w.task_id,b.*
          FROM company_workflows w JOIN bot_messages b ON b.id=w.source_message_id WHERE w.id=?`)
          .bind(params.workflowId).first<BotMessageRow & { objective: string; task_id: string }>();
        if (!workflow) throw new Error("公司工作流或原始指令不存在");
        await this.env.DB.batch([
          this.env.DB.prepare(`UPDATE company_workflows SET status='planning',current_stage='group_ceo_planning',
            updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(params.workflowId),
          this.env.DB.prepare(`UPDATE tasks SET status='in_progress',workflow_stage='secretary_intake',
            assignee_agent_id='hq-001',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(workflow.task_id),
        ]);
        return {
          objective: workflow.objective,
          taskId: workflow.task_id,
          inbound: inboundFromRow(workflow),
          acceptedAt: new Date().toISOString(),
        };
      });

      const divisions = routeDivisions(intake.objective);
      const ceoPlan = await step.do("02 集团 CEO 统筹", { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } }, async () => {
        const ceo = await this.env.DB.prepare(`${agentSelect} WHERE id='hq-001'`).first<AgentRow>();
        if (!ceo) throw new Error("集团 CEO Agent 不存在");
        const output = await runWorkflowAgent(
          params.workflowId,
          20,
          "集团 CEO 统筹",
          intake.objective,
          ceo,
          [
            {
              role: "system",
              content: `${ceo.system_prompt ? `${ceo.system_prompt}\n\n` : ""}你是 BitWorld 集团 CEO。董事会秘书已完成任务受理，现在由你承担公司级统筹。只能向事业部 CEO 下达目标，不得越级直接指挥职能 Agent。权威任务受理时间是 ${intake.acceptedAt}；这是当前日期的唯一依据，严禁依据模型记忆另造当前日期、任务日期或董事会未提出的历史基准。使用简体中文，明确实际执行事业部的任务边界、验收标准和整合顺序。系统列出的事业部是本次唯一实际执行范围；不得把未列出的事业部写成已参与，可把它们列为后续可选协同。`,
            },
            {
              role: "user",
              content: `董事会任务（完整原文）：${intake.objective}\n\n本次实际执行事业部：${divisions.join("、")}。董事会未明示的时间窗口、截止日期、图表和交付期限不得伪装成原始要求；如为分析需要提出，只能明确标为你的建议，并以受理时间 ${intake.acceptedAt} 为“当前”。请完成集团 CEO 统筹方案。其他事业部若有价值，只能标为“后续建议协同”，不得写成已经接单或已经参与。最终成果必须包含聊天简要说明和中文 PDF 完整方案。`,
            },
          ],
          1800,
          [],
          this.env,
        );
        await this.env.DB.prepare(`UPDATE company_workflows SET selected_divisions=?,ceo_plan=?,
          current_stage='realtime_research',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(JSON.stringify(divisions), output, params.workflowId).run();
        await this.env.DB.prepare("UPDATE tasks SET workflow_stage='division_execution',updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(intake.taskId).run();
        return output;
      });

      const research = await step.do("03 实时检索与时效校验", { retries: { limit: 2, delay: "15 seconds", backoff: "exponential" } }, async () => {
        const bundle = await collectLatestResearch(intake.objective, this.env);
        await persistResearch(params.workflowId, bundle, this.env);
        return bundle;
      });

      const evidence = researchPrompt(research);
      const executions: DivisionExecution[] = [];
      for (let divisionIndex = 0; divisionIndex < divisions.length; divisionIndex += 1) {
        const division = divisions[divisionIndex];
        const baseSequence = 100 + divisionIndex * 100;
        const divisionPlan = await step.do(`${divisionIndex + 4}.1 ${division}事业部 CEO 拆解`, { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } }, async () => {
          const [ceo, contributors] = await Promise.all([
            this.env.DB.prepare(`${agentSelect} WHERE division=? AND title LIKE '%负责人%' AND status<>'paused' ORDER BY id LIMIT 1`)
              .bind(division).first<AgentRow>(),
            this.env.DB.prepare(`${agentSelect} WHERE division=? AND title NOT LIKE '%负责人%' AND status<>'paused' ORDER BY id`)
              .bind(division).all<AgentRow>(),
          ]);
          if (!ceo) throw new Error(`${division}事业部 CEO 不存在或已暂停`);
          if (!contributors.results.length) throw new Error(`${division}事业部没有可用的职能 Agent`);
          const generatedPlan = await runWorkflowAgent(
            params.workflowId,
            baseSequence,
            `${division}事业部 CEO 拆解`,
            intake.objective,
            ceo,
            [
              {
                role: "system",
                content: `你是 BitWorld ${division}事业部 CEO。集团 CEO 已下达目标；你负责把任务拆给本事业部的职能 Agent，完成后还要亲自整合。权威当前时间是 ${research.fetchedAt}，不得采用集团方案里与该时间冲突的日期，不得把建议条件误写成董事会原始要求。不得把未核验资料当事实。`,
              },
              {
                role: "user",
                content: `董事会任务：${intake.objective}\n\n集团 CEO 统筹：\n${ceoPlan}\n\n可用职能：${contributors.results.map((agent) => `${agent.name}（${agent.title}）`).join("、")}\n\n${evidence}\n\n请给出面向上述职能的分工单，每人明确问题、证据要求和交付格式。`,
              },
            ],
            1600,
            sourceIds(research),
            this.env,
          );
          const output = ensureDivisionPlanCoverage(generatedPlan, contributors.results);
          await this.env.DB.prepare(`UPDATE company_workflows SET status='executing',current_stage='division_execution',
            updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(params.workflowId).run();
          return { ceo, contributors: contributors.results, output };
        });

        const contributorOutputs = await Promise.all(divisionPlan.contributors.map((agent, contributorIndex) => (
          step.do(
            `${divisionIndex + 4}.2 ${division}-${agent.id} 职能执行`,
            { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } },
            async () => {
              const output = await runWorkflowAgent(
                params.workflowId,
                baseSequence + contributorIndex + 1,
                `${division}职能执行`,
                intake.objective,
                agent,
                [
                  {
                  role: "system",
                  content: `${agent.system_prompt ? `${agent.system_prompt}\n\n` : ""}你是 ${division}事业部的${agent.title}（${agent.name}）。你只解决事业部 CEO 分配给本职能的问题。权威当前时间与数据截止时间是 ${research.fetchedAt}；若上游文字出现冲突日期，以该时间为准并指出冲突，不得延续。使用简体中文；外部事实必须引用 [S编号]；不得用模型记忆补充最新数据。交付固定包含：本职能结论、证据、限制、建议。`,
                  },
                  {
                    role: "user",
                    content: `董事会任务：${intake.objective}\n\n事业部 CEO 分工单：\n${divisionPlan.output}\n\n${evidence}`,
                  },
                ],
                2200,
                sourceIds(research),
                this.env,
              );
              return { agentId: agent.id, agentName: agent.name, title: agent.title, output };
            },
          )
        )));

        const integratedOutput = await step.do(`${divisionIndex + 4}.3 ${division}事业部 CEO 整合`, { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } }, async () => (
          runWorkflowAgent(
            params.workflowId,
            baseSequence + 90,
            `${division}事业部 CEO 整合`,
            intake.objective,
            divisionPlan.ceo,
            [
              {
                role: "system",
                content: `你是 BitWorld ${division}事业部 CEO。请对职能成果做交叉核验、去重和冲突处理，然后形成交付集团/董秘的专业事业部结论。权威当前时间与数据截止时间是 ${research.fetchedAt}；任何其他“当前日期”或未经原始任务明确的历史基准都必须删除或纠正。不得保留没有来源的最新数字。`,
              },
              {
                role: "user",
                content: `董事会任务：${intake.objective}\n\n集团 CEO 统筹：${ceoPlan}\n\n职能成果：\n${contributorOutputs.map((item) => `\n### ${item.agentName}｜${item.title}\n${item.output}`).join("\n")}\n\n${evidence}\n\n请输出：核心判断、关键证据、分歧与不确定性、风险、行动建议、需总部决策。`,
              },
            ],
            3000,
            sourceIds(research),
            this.env,
          )
        ));
        await step.do(`${divisionIndex + 4}.4 ${division}事业部成果回传`, async () => {
          await this.env.DB.prepare("UPDATE tasks SET workflow_stage='division_review',updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .bind(intake.taskId).run();
        });
        executions.push({
          division,
          ceoName: divisionPlan.ceo.name,
          ceoPlan: divisionPlan.output,
          contributors: contributorOutputs,
          integratedOutput,
        });
      }

      const final = await step.do("90 董秘复核与终稿", { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } }, async () => {
        const secretary = await this.env.DB.prepare(`${agentSelect} WHERE id='hq-003'`).first<AgentRow>();
        if (!secretary) throw new Error("董秘 Agent 不存在");
        await this.env.DB.prepare(`UPDATE company_workflows SET status='integrating',current_stage='secretary_synthesis',
          updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(params.workflowId).run();
        await this.env.DB.prepare("UPDATE tasks SET workflow_stage='secretary_synthesis',assignee_agent_id='hq-003',updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(intake.taskId).run();
        const output = await runWorkflowAgent(
          params.workflowId,
          900,
          "董秘复核与终稿",
          intake.objective,
          secretary,
          [
            {
              role: "system",
              content: `${secretary.system_prompt ? `${secretary.system_prompt}\n\n` : ""}你负责最终成果编辑。权威当前时间与数据截止时间是 ${research.fetchedAt}；报告日期只能取该时间的日期。原始问题未明示的年份、历史基准、期限或图表不得擅自补成用户要求，遇到素材中的虚构或冲突必须删除。使用简体中文，保留 [S编号] 引用并严格区分事实、推断与建议。

最终只输出两个 XML 标记块，不得在标记块外输出任何文字：
<USER_SUMMARY>
直接回答用户原始问题的结论摘要，200—600 字；结论先行，可用 3—5 个短要点。只写用户需要知道的发现、判断、风险和建议，不介绍组织、角色、模型、流程、分工、来源条数或内部编号。
</USER_SUMMARY>
<REPORT>
可直接排版成 PDF 的专业中文研究报告正文。围绕主题组织章节，通常包含核心数据与事实、关键分析、趋势或情景、风险与限制、结论与行动建议；可根据问题类型增删，不要机械套模板。不要设置“研究范围与口径”“数据口径”“口径说明”“方法说明”等前置章节，直接进入对用户有价值的主题分析。正文须有内联 [S编号] 引用，但不要单独复制来源清单。禁止出现组织、角色、模型、工作流、责任链、内部审核与分工信息，也不要写“待董事会决策”。
</REPORT>`,
            },
            {
              role: "user",
              content: `用户原始问题：${intake.objective}

以下是已核验的专业研究素材，仅供综合。不得在最终成果中提及素材来自哪个组织、角色或内部环节：
${executions.map((item, index) => `
### 研究素材 ${index + 1}
${item.integratedOutput}`).join("\n")}

公开证据：
${evidence}

请按系统规定输出直接结论摘要与完整主题报告。`,
            },
          ],
          6000,
          sourceIds(research),
          this.env,
        );
        const delivery = parseSecretaryDelivery(output);
        validateFinalReport(delivery.report, intake.objective, research, executions);
        await this.env.DB.prepare(`UPDATE company_workflows SET executive_summary=?,final_report=?,
          status='delivering',current_stage='pdf_generation',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(delivery.summary, delivery.report, params.workflowId).run();
        return { output: delivery.report, summary: delivery.summary, secretaryName: secretary.name };
      });

      const pdf = await step.do("95 生成中文 PDF", { retries: { limit: 2, delay: "20 seconds", backoff: "exponential" }, timeout: "5 minutes" }, async () => {
        const key = `reports/${params.userId}/${params.workflowId}.pdf`;
        const bytes = await generateReportPdf(this.env.BROWSER, {
          title: workflowTitle(intake.objective),
          executiveSummary: final.summary,
          content: final.output,
          generatedAt: new Date().toISOString(),
          sourceCutoffAt: research.fetchedAt,
          sources: workflowSourceRows(research),
        });
        await this.env.DB.prepare(`INSERT OR REPLACE INTO report_artifacts
          (id,workflow_id,body,content_type,byte_size) VALUES (?,?,?,'application/pdf',?)`)
          .bind(key, params.workflowId, bytes.buffer, bytes.byteLength).run();
        await this.env.DB.prepare("UPDATE company_workflows SET pdf_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(key, params.workflowId).run();
        return { key, byteSize: bytes.byteLength };
      });

      await step.do("96 归档正式成果", async () => {
        const reportId = `workflow-report:${params.workflowId}`;
        const pdfUrl = `${this.env.PUBLIC_ORIGIN.replace(/\/$/, "")}/artifacts/${params.workflowId}/${params.downloadToken}.pdf`;
        const decisionStatus = /无需(?:总部|董事会)?决策|无待决策事项/.test(final.output) ? "informational" : "needs_decision";
        await this.env.DB.batch([
          this.env.DB.prepare(`INSERT OR REPLACE INTO reports
            (id,title,type,summary,content,status,author,task_id,division,decision_status,confidence,recommendation,
             workflow_id,pdf_url,source_count,source_cutoff_at)
            VALUES (?,?,?,?,?,'published',?,?,?,?,?,?,?,?,?,?)`)
            .bind(
              reportId,
              workflowTitle(intake.objective),
              "专题研究报告",
              final.summary,
              final.output,
              final.secretaryName,
              intake.taskId,
              divisions.join("、"),
              decisionStatus,
              "high",
              "请按报告中的结论与行动建议推进。",
              params.workflowId,
              pdfUrl,
              research.sources.length,
              research.fetchedAt,
            ),
          this.env.DB.prepare(`UPDATE tasks SET status='done',workflow_stage='archived',final_report_id=?,
            division=?,assignee_agent_id='hq-003',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
            .bind(reportId, divisions.join("、"), intake.taskId),
          this.env.DB.prepare(`UPDATE company_workflows SET status='delivering',current_stage='user_delivery',
            updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(params.workflowId),
        ]);
      });

      await step.do("97 发送直接结论", { retries: { limit: 5, delay: "20 seconds", backoff: "exponential" } }, async () => {
        const state = await this.env.DB.prepare("SELECT summary_delivered_at FROM company_workflows WHERE id=?")
          .bind(params.workflowId).first<{ summary_delivered_at: string | null }>();
        if (state?.summary_delivered_at) return;
        const resultMessageId = `result:${intake.inbound.externalMessageId}:${params.workflowId}`;
        const existing = await this.env.DB.prepare(`SELECT id,status FROM bot_messages
          WHERE channel_id=? AND external_message_id=? AND role='assistant'`)
          .bind(intake.inbound.channelId, resultMessageId).first<{ id: string; status: string }>();
        if (existing?.status === "succeeded") {
          await this.env.DB.prepare("UPDATE company_workflows SET summary_delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .bind(params.workflowId).run();
          return;
        }
        const messageId = existing?.id ?? crypto.randomUUID();
        if (!existing) {
          await this.env.DB.prepare(`INSERT INTO bot_messages
            (id,user_id,channel_id,provider,external_message_id,conversation_id,role,content,status)
            VALUES (?,?,?,?,?,?,? ,?,'processing')`)
            .bind(
              messageId,
              intake.inbound.userId,
              intake.inbound.channelId,
              intake.inbound.provider,
              resultMessageId,
              intake.inbound.conversationId,
              "assistant",
              final.summary,
            ).run();
        }
        const deliveryText = final.summary;
        await sendInboundReply(intake.inbound, deliveryText, this.env);
        await this.env.DB.batch([
          this.env.DB.prepare("UPDATE bot_messages SET content=?,status='succeeded',updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .bind(deliveryText, messageId),
          this.env.DB.prepare("UPDATE company_workflows SET summary_delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .bind(params.workflowId),
        ]);
      });

      await step.do("98 发送 PDF 文件", { retries: { limit: 5, delay: "20 seconds", backoff: "exponential" } }, async () => {
        const state = await this.env.DB.prepare("SELECT document_delivered_at,pdf_key FROM company_workflows WHERE id=?")
          .bind(params.workflowId).first<{ document_delivered_at: string | null; pdf_key: string | null }>();
        if (state?.document_delivered_at) return;
        if (!state?.pdf_key) throw new Error("PDF 文件尚未生成");
        const artifact = await this.env.DB.prepare("SELECT body,byte_size FROM report_artifacts WHERE id=? AND workflow_id=?")
          .bind(state.pdf_key, params.workflowId).first<{ body: number[]; byte_size: number }>();
        if (!artifact?.body) throw new Error("PDF 文件不存在");
        const bytes = Uint8Array.from(artifact.body);
        if (bytes.byteLength !== artifact.byte_size) throw new Error("PDF 文件读取不完整");
        const reportName = `${workflowTitle(intake.objective).replace(/[\\/:*?"<>|]/g, "-").slice(0, 72)}_完整报告.pdf`;
        await sendInboundDocument(intake.inbound, bytes, reportName, "完整分析报告（PDF）", this.env);
        await this.env.DB.prepare("UPDATE company_workflows SET document_delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(params.workflowId).run();
      });

      await step.do("99 完成交付", async () => {
        await this.env.DB.batch([
          this.env.DB.prepare(`UPDATE company_workflows SET status='completed',current_stage='completed',
            completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(params.workflowId),
          this.env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)")
            .bind(crypto.randomUUID(), "report", `已交付：${workflowTitle(intake.objective)}`, final.secretaryName),
        ]);
        console.log(JSON.stringify({
          event: "company_workflow_completed",
          workflowId: params.workflowId,
          divisions,
          sourceCount: research.sources.length,
          pdfBytes: pdf.byteSize,
        }));
      });
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "未知公司工作流错误";
      await step.do("失败归档与通知", async () => {
        await this.env.DB.prepare(`UPDATE company_workflows SET status='failed',current_stage='failed',
          error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(reason.slice(0, 1000), params.workflowId).run();
        const inbound = await this.env.DB.prepare(`SELECT b.* FROM company_workflows w
          JOIN bot_messages b ON b.id=w.source_message_id WHERE w.id=?`)
          .bind(params.workflowId).first<BotMessageRow>();
        if (inbound) {
          await sendInboundReply(
            inboundFromRow(inbound),
            `这次报告未能可靠完成，因此没有交付可能误导你的结论。\n\n原因：${reason.slice(0, 500)}\n\n请稍后重试；系统不会用旧数据或未经核验的信息补写报告。`,
            this.env,
          );
        }
      });
      throw caught;
    }
  }
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
    const result = await executeModelRoute(context, messages, env);
    const output = result.output;
    const usage = result.usage;
    const reportId = crypto.randomUUID();
    const summary = output.replace(/[#*_`>\n]/g, " ").replace(/\s+/g, " ").slice(0, 180);
    const decisionStatus = /无需(?:总部)?决策|不需要(?:总部)?决策|无待决策事项/.test(output) ? "informational" : "needs_decision";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO reports (id,run_id,title,type,summary,content,author,task_id,division,decision_status,confidence,recommendation) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(reportId, context.run_id, context.task_title, context.source === "schedule" ? "定时情报" : "事业部任务成果", summary, output, context.agent_name, context.task_id, context.division, decisionStatus, "medium", summary),
      env.DB.prepare("UPDATE runs SET status='succeeded',model=?,provider=?,neurons_used=?,output_excerpt=?,input_tokens=?,output_tokens=?,total_tokens=?,finished_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(result.model, result.provider, result.neuronsUsed, summary, usage.inputTokens, usage.outputTokens, usage.totalTokens, context.run_id),
      env.DB.prepare("UPDATE tasks SET status='in_review',workflow_stage='secretary_synthesis',final_report_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(reportId, context.task_id),
      env.DB.prepare(`UPDATE agents SET
        status='active',
        current_task=NULL,
        monthly_input_tokens=CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_input_tokens+? ELSE ? END,
        monthly_output_tokens=CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_output_tokens+? ELSE ? END,
        monthly_tokens_used=CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_tokens_used+? ELSE ? END,
        monthly_neurons_used=CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_neurons_used+? ELSE ? END,
        token_period=strftime('%Y-%m','now'),
        last_seen_at=CURRENT_TIMESTAMP,
        updated_at=CURRENT_TIMESTAMP
        WHERE id=?`)
        .bind(usage.inputTokens, usage.inputTokens, usage.outputTokens, usage.outputTokens, usage.totalTokens, usage.totalTokens, result.neuronsUsed, result.neuronsUsed, context.agent_id),
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

async function acceptBotWebhook(request: Request, provider: "telegram" | "feishu", channelId: string, env: Env): Promise<Response> {
  if (request.method !== "POST") return error("仅接受 POST 回调", 405);
  try {
    const result = provider === "telegram"
      ? await acceptTelegramWebhook(request, channelId, env)
      : await acceptFeishuWebhook(request, channelId, env);
    if (result.kind === "challenge") return json({ challenge: result.challenge });
    if (result.kind === "ignored") return provider === "feishu" ? json({ code: 0 }) : json({ ok: true });
    const messageId = crypto.randomUUID();
    const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO bot_messages
      (id,user_id,channel_id,provider,external_message_id,conversation_id,sender_id,role,content,status)
      VALUES (?,?,?,?,?,?,?,?,?,'pending')`)
      .bind(
        messageId,
        result.message.userId,
        result.message.channelId,
        result.message.provider,
        result.message.externalMessageId,
        result.message.conversationId,
        result.message.senderId,
        "user",
        result.message.text,
      ).run();
    if (inserted.meta.changes) await env.TASK_QUEUE.send({ kind: "bot_reply", messageId } satisfies BotReplyMessage);
    return provider === "feishu" ? json({ code: 0 }) : json({ ok: true });
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : "未知回调错误";
    console.warn(JSON.stringify({ event: "bot_webhook_rejected", provider, channelId, reason: reason.slice(0, 240) }));
    return error("回调校验失败", 401);
  }
}

function inboundFromRow(row: BotMessageRow): InboundBotMessage {
  return {
    channelId: row.channel_id,
    userId: row.user_id,
    provider: row.provider,
    externalMessageId: row.external_message_id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    text: row.content,
  };
}

function isCompanyTaskRequest(content: string): boolean {
  const normalized = content.trim();
  if (normalized.length < 10) return false;
  if (/^(你好|您好|在吗|谢谢|收到|好的|明白|测试|test)[！!。.\s]*$/i.test(normalized)) return false;
  return /请|帮我|给我|整理|分析|研究|调研|报告|方案|评估|复盘|规划|计划|监测|扫描|汇总|制作|生成|设计|解决|查找|搜索|最新|近期|趋势|风险|如何|能否/.test(normalized);
}

async function startCompanyWorkflow(inbound: BotMessageRow, env: Env): Promise<string> {
  const existing = await env.DB.prepare(`SELECT id,task_id,status FROM company_workflows WHERE source_message_id=?`)
    .bind(inbound.id).first<{ id: string; task_id: string; status: string }>();
  let workflowId = existing?.id;
  let created = false;
  let downloadToken = "";
  if (!workflowId) {
    workflowId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    downloadToken = randomToken(24);
    const tokenHash = bytesToBase64Url(await digest(downloadToken));
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO tasks
        (id,title,description,status,priority,division,assignee_agent_id,source,workflow_stage,requested_by,
         output_requirements,company_workflow_id)
        VALUES (?,?,?,'in_progress','high','总部','hq-001','secretary','secretary_intake','HQ-003-董秘',
          '直接回答原始问题并发送中文 PDF 文件；报告不得包含内部流程信息；最新事实必须附来源、发布时间与抓取时间',?)`)
        .bind(taskId, workflowTitle(inbound.content), inbound.content, workflowId),
      env.DB.prepare(`INSERT INTO company_workflows
        (id,user_id,source_message_id,task_id,provider,objective,download_token_hash)
        VALUES (?,?,?,?,?,?,?)`)
        .bind(workflowId, inbound.user_id, inbound.id, taskId, inbound.provider, inbound.content, tokenHash),
      env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)")
        .bind(crypto.randomUUID(), "workflow", `董秘受理：${workflowTitle(inbound.content)}`, "HQ-003-董秘"),
    ]);
    created = true;
  } else {
    const workflow = await env.DB.prepare("SELECT download_token_hash FROM company_workflows WHERE id=?")
      .bind(workflowId).first<{ download_token_hash: string }>();
    if (!workflow) throw new Error("公司工作流状态不存在");
  }
  if (created) {
    await env.COMPANY_WORKFLOW.create({
      id: workflowId,
      params: {
        workflowId,
        userId: inbound.user_id,
        sourceMessageId: inbound.id,
        downloadToken,
      } satisfies CompanyWorkflowParams,
    });
  } else if (workflowId) {
    const instance = await env.COMPANY_WORKFLOW.get(workflowId);
    const instanceStatus = await instance.status();
    if (instanceStatus.status === "unknown") {
      downloadToken = randomToken(24);
      await env.DB.prepare("UPDATE company_workflows SET download_token_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(bytesToBase64Url(await digest(downloadToken)), workflowId).run();
      await env.COMPANY_WORKFLOW.create({
        id: workflowId,
        params: {
          workflowId,
          userId: inbound.user_id,
          sourceMessageId: inbound.id,
          downloadToken,
        } satisfies CompanyWorkflowParams,
      });
    }
  }
  return [
    `已收到：${workflowTitle(inbound.content)}`,
    "",
    "我会围绕你的问题整理核心结论，并在完成后直接发送 PDF 完整报告文件。",
    "涉及最新信息时会以实时检索结果为准；无法核验的数据会明确标注，不会用旧信息补写。",
  ].join("\n");
}

async function executeBotReply(message: Message<BotReplyMessage>, env: Env): Promise<void> {
  const inbound = await env.DB.prepare("SELECT * FROM bot_messages WHERE id=? AND role='user'")
    .bind(message.body.messageId).first<BotMessageRow>();
  if (!inbound) {
    message.ack();
    return;
  }
  const replyExternalId = `reply:${inbound.external_message_id}`;
  try {
    await env.DB.prepare("UPDATE bot_messages SET status='processing',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(inbound.id).run();
    let reply = await env.DB.prepare("SELECT * FROM bot_messages WHERE channel_id=? AND external_message_id=? AND role='assistant'")
      .bind(inbound.channel_id, replyExternalId).first<BotMessageRow>();
    if (isCompanyTaskRequest(inbound.content)) {
      if (!reply) {
        const acknowledgement = await startCompanyWorkflow(inbound, env);
        const replyId = crypto.randomUUID();
        await env.DB.prepare(`INSERT INTO bot_messages
          (id,user_id,channel_id,provider,external_message_id,conversation_id,role,content,status)
          VALUES (?,?,?,?,?,?,? ,?,'processing')`)
          .bind(
            replyId,
            inbound.user_id,
            inbound.channel_id,
            inbound.provider,
            replyExternalId,
            inbound.conversation_id,
            "assistant",
            acknowledgement,
          ).run();
        reply = await env.DB.prepare("SELECT * FROM bot_messages WHERE id=?").bind(replyId).first<BotMessageRow>();
      }
      if (!reply) throw new Error("董秘受理回执生成失败");
      if (reply.status !== "succeeded") await sendInboundReply(inboundFromRow(inbound), reply.content, env);
      await env.DB.prepare("UPDATE bot_messages SET status='succeeded',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id IN (?,?)")
        .bind(inbound.id, reply.id).run();
      message.ack();
      return;
    }
    if (!reply) {
      const agent = await env.DB.prepare(`${agentSelect}
        WHERE id='hq-003' OR title='董事会秘书'
        ORDER BY CASE WHEN id='hq-003' THEN 0 ELSE 1 END LIMIT 1`).first<AgentRow>();
      if (!agent) throw new Error("未找到董秘 Agent");
      const history = (await env.DB.prepare(`SELECT role,content FROM bot_messages
        WHERE channel_id=? AND conversation_id=? AND id<>? AND status='succeeded'
        ORDER BY created_at DESC LIMIT 10`)
        .bind(inbound.channel_id, inbound.conversation_id, inbound.id)
        .all<{ role: "user" | "assistant"; content: string }>()).results.reverse();
      const context: RunContext = {
        run_id: `chat:${inbound.id}`,
        task_id: inbound.id,
        task_title: "董秘即时会话",
        task_description: inbound.content,
        agent_id: agent.id,
        agent_name: agent.name,
        agent_title: agent.title,
        division: agent.division,
        model: agent.model,
        source: inbound.provider,
        output_requirements: "简明、专业、可执行",
        system_prompt: agent.system_prompt,
        temperature: agent.temperature,
        reasoning_mode: agent.reasoning_mode,
        max_output_tokens: Math.min(agent.max_output_tokens, 1800),
        execution_timeout_sec: agent.execution_timeout_sec,
        max_retries: agent.max_retries,
        tool_policy: agent.tool_policy,
        memory_policy: agent.memory_policy,
      };
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: `${agent.system_prompt ? `${agent.system_prompt}\n\n` : ""}你是 BitWorld 董事会秘书，是一人公司的统一经营入口。请始终使用简体中文，先直接回答用户当前问题，再在必要时给出下一步。对需要事业部执行的工作，应说明建议派给哪个事业部以及交付标准；不要声称已经创建任务、调用工具或完成外部操作，除非系统明确提供了执行结果。回复适合在即时通讯中阅读，避免冗长套话。`,
        },
        ...history.map((item) => ({ role: item.role, content: item.content })),
        { role: "user", content: inbound.content },
      ];
      const result = await executeModelRoute(context, messages, env);
      const replyId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO bot_messages
          (id,user_id,channel_id,provider,external_message_id,conversation_id,role,content,status,model,model_provider,input_tokens,output_tokens,total_tokens)
          VALUES (?,?,?,?,?,?,? ,?,'processing',?,?,?,?,?)`)
          .bind(
            replyId,
            inbound.user_id,
            inbound.channel_id,
            inbound.provider,
            replyExternalId,
            inbound.conversation_id,
            "assistant",
            result.output,
            result.model,
            result.provider,
            result.usage.inputTokens,
            result.usage.outputTokens,
            result.usage.totalTokens,
          ),
        env.DB.prepare(`UPDATE agents SET
          monthly_input_tokens=CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_input_tokens+? ELSE ? END,
          monthly_output_tokens=CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_output_tokens+? ELSE ? END,
          monthly_tokens_used=CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_tokens_used+? ELSE ? END,
          monthly_neurons_used=CASE WHEN token_period=strftime('%Y-%m','now') THEN monthly_neurons_used+? ELSE ? END,
          token_period=strftime('%Y-%m','now'),last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(
            result.usage.inputTokens,
            result.usage.inputTokens,
            result.usage.outputTokens,
            result.usage.outputTokens,
            result.usage.totalTokens,
            result.usage.totalTokens,
            result.neuronsUsed,
            result.neuronsUsed,
            agent.id,
          ),
      ]);
      reply = await env.DB.prepare("SELECT * FROM bot_messages WHERE id=?").bind(replyId).first<BotMessageRow>();
    }
    if (!reply) throw new Error("董秘回复生成失败");
    await sendInboundReply(inboundFromRow(inbound), reply.content, env);
    await env.DB.batch([
      env.DB.prepare("UPDATE bot_messages SET status='succeeded',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id IN (?,?)")
        .bind(inbound.id, reply.id),
      env.DB.prepare("INSERT INTO activity (id,type,summary,actor) VALUES (?,?,?,?)")
        .bind(crypto.randomUUID(), "bot_chat", `${inbound.provider === "telegram" ? "Telegram" : "飞书"} 董秘已回复`, "HQ-003-董秘"),
    ]);
    message.ack();
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : "未知董秘回复错误";
    await env.DB.prepare("UPDATE bot_messages SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(reason.slice(0, 500), inbound.id).run();
    if (message.attempts <= 2) {
      message.retry({ delaySeconds: 10 * message.attempts });
      return;
    }
    try {
      await sendInboundReply(inboundFromRow(inbound), "抱歉，董秘暂时未能完成回复。系统已记录本次失败，请稍后再试。", env);
    } catch (replyError) {
      console.warn(JSON.stringify({
        event: "bot_failure_reply_failed",
        provider: inbound.provider,
        reason: replyError instanceof Error ? replyError.message.slice(0, 240) : "未知错误",
      }));
    }
    message.ack();
  }
}

async function serveWorkflowArtifact(
  request: Request,
  workflowId: string,
  downloadToken: string,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return error("仅支持读取报告", 405);
  if (workflowId.length > 100 || downloadToken.length > 200) return error("报告链接无效", 404);
  const workflow = await env.DB.prepare(`SELECT objective,pdf_key,download_token_hash,status
    FROM company_workflows WHERE id=?`).bind(workflowId)
    .first<{ objective: string; pdf_key: string | null; download_token_hash: string; status: string }>();
  if (!workflow?.pdf_key || workflow.status !== "completed") return error("报告尚未生成或不存在", 404);
  const supplied = await digest(downloadToken);
  let expected: Uint8Array;
  try { expected = base64UrlToBytes(workflow.download_token_hash); }
  catch { return error("报告链接无效", 404); }
  if (!constantTimeEqual(supplied, expected)) return error("报告链接无效", 404);
  const object = await env.DB.prepare("SELECT body,content_type,byte_size FROM report_artifacts WHERE id=? AND workflow_id=?")
    .bind(workflow.pdf_key, workflowId).first<{ body: number[]; content_type: string; byte_size: number }>();
  if (!object?.body) return error("报告文件不存在", 404);
  const body = Uint8Array.from(object.body);
  if (body.byteLength !== object.byte_size) return error("报告文件校验失败", 500);
  const headers = new Headers();
  headers.set("content-type", object.content_type || "application/pdf");
  headers.set("content-disposition", `inline; filename="BitWorld-${workflowId}.pdf"`);
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-length", String(object.byte_size));
  return new Response(request.method === "HEAD" ? null : body, { headers });
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

async function recoverPendingBotReplies(env: Env): Promise<number> {
  const messages = (await env.DB.prepare(`SELECT id FROM bot_messages
    WHERE role='user' AND (
      (status='pending' AND updated_at<=datetime('now','-2 minutes'))
      OR (status='processing' AND updated_at<=datetime('now','-20 minutes'))
    )
    ORDER BY updated_at
    LIMIT 25`).all<{ id: string }>()).results;
  for (const item of messages) {
    await env.TASK_QUEUE.send({ kind: "bot_reply", messageId: item.id } satisfies BotReplyMessage);
    await env.DB.prepare(`UPDATE bot_messages
      SET status='pending',error=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND role='user' AND status IN ('pending','processing')`)
      .bind(item.id).run();
  }
  return messages.length;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const artifactMatch = url.pathname.match(/^\/artifacts\/([^/]+)\/([^/]+)\.pdf$/);
    if (artifactMatch) return serveWorkflowArtifact(
      request,
      decodeURIComponent(artifactMatch[1]),
      decodeURIComponent(artifactMatch[2]),
      env,
    );
    const webhookMatch = url.pathname.match(/^\/webhooks\/(telegram|feishu)\/([^/]+)$/);
    if (webhookMatch) return acceptBotWebhook(request, webhookMatch[1] as "telegram" | "feishu", decodeURIComponent(webhookMatch[2]), env);
    if (url.pathname.startsWith("/api/")) return api(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
  async queue(batch: MessageBatch<QueueMessage>, env: Env, ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      if ("kind" in message.body && message.body.kind === "bot_reply") {
        await executeBotReply(message as Message<BotReplyMessage>, env);
      } else {
        await executeRun(message as Message<RunMessage>, env, ctx);
      }
    }
  },
  async scheduled(_controller, env): Promise<void> {
    const [dispatched, recoveredBotReplies] = await Promise.all([
      dispatchDueSchedules(env),
      recoverPendingBotReplies(env),
    ]);
    console.log(JSON.stringify({ event: "scheduled_dispatch", dispatched, recoveredBotReplies }));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM auth_attempts WHERE attempted_at < datetime('now','-1 day')"),
      env.DB.prepare("DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP"),
      env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < CURRENT_TIMESTAMP"),
      env.DB.prepare("DELETE FROM email_auth_codes WHERE expires_at < datetime('now','-1 day') OR consumed_at IS NOT NULL"),
    ]);
  },
} satisfies ExportedHandler<Env, QueueMessage>;
