export type NotificationProvider = "telegram" | "feishu" | "wecom";
export type NotificationEvent = "task_completed" | "report_published" | "run_failed" | "approval_decided";

type NotificationConfig = Record<string, string>;

type ChannelRow = {
  id: string;
  provider: NotificationProvider;
  name: string;
  enabled: number;
  events: string;
  config_ciphertext: string;
  last_test_at: string | null;
  last_test_status: "success" | "failed" | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type NotificationPayload = {
  event: NotificationEvent;
  title: string;
  body: string;
  detail?: string;
  url?: string;
};

const providerNames: Record<NotificationProvider, string> = {
  telegram: "Telegram",
  feishu: "飞书",
  wecom: "企业微信",
};

const eventNames: Record<NotificationEvent, string> = {
  task_completed: "任务完成",
  report_published: "报告发布",
  run_failed: "运行失败",
  approval_decided: "审批结果",
};

const allowedEvents = new Set<NotificationEvent>(Object.keys(eventNames) as NotificationEvent[]);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`bitworld:notifications:${env.SESSION_SECRET}`),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptConfig(config: NotificationConfig, env: Env): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv).buffer },
    await encryptionKey(env),
    new TextEncoder().encode(JSON.stringify(config)),
  );
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

async function decryptConfig(ciphertext: string, env: Env): Promise<NotificationConfig> {
  const [version, ivValue, cipherValue] = ciphertext.split(".");
  if (version !== "v1" || !ivValue || !cipherValue) throw new Error("通知配置无法解密");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(base64ToBytes(ivValue)).buffer },
    await encryptionKey(env),
    new Uint8Array(base64ToBytes(cipherValue)).buffer,
  );
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("通知配置格式无效");
  return parsed as NotificationConfig;
}

function providerFrom(value: string): NotificationProvider | null {
  return value === "telegram" || value === "feishu" || value === "wecom" ? value : null;
}

function normalizeEvents(value: unknown): NotificationEvent[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is NotificationEvent => typeof item === "string" && allowedEvents.has(item as NotificationEvent))));
}

function cleanConfig(value: unknown): NotificationConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, item]) => [key, item.trim()])
      .filter(([, item]) => Boolean(item)),
  );
}

function validateWebhook(value: string, provider: "feishu" | "wecom"): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Webhook 地址格式不正确"); }
  if (url.protocol !== "https:") throw new Error("Webhook 必须使用 HTTPS");
  if (provider === "feishu") {
    if (!["open.feishu.cn", "open.larksuite.com"].includes(url.hostname) || !url.pathname.startsWith("/open-apis/bot/v2/hook/")) {
      throw new Error("请输入飞书开放平台生成的群机器人 Webhook");
    }
  } else if (url.hostname !== "qyapi.weixin.qq.com" || url.pathname !== "/cgi-bin/webhook/send" || !url.searchParams.get("key")) {
    throw new Error("请输入企业微信群机器人生成的 Webhook");
  }
  return url;
}

function validateConfig(provider: NotificationProvider, config: NotificationConfig): void {
  if (provider === "telegram") {
    if (!/^\d{6,12}:[A-Za-z0-9_-]{20,}$/.test(config.botToken ?? "")) throw new Error("Telegram Bot Token 格式不正确");
    if (!/^(@[A-Za-z0-9_]{5,}|-?\d+)$/.test(config.chatId ?? "")) throw new Error("Telegram Chat ID 格式不正确");
    if (config.topicId && !/^\d+$/.test(config.topicId)) throw new Error("Telegram 话题 ID 必须是数字");
  } else if (provider === "feishu") {
    validateWebhook(config.webhookUrl ?? "", "feishu");
  } else {
    validateWebhook(config.webhookUrl ?? "", "wecom");
  }
}

function configSummary(provider: NotificationProvider, config: NotificationConfig): string {
  if (provider === "telegram") return config.chatId ? `目标 ${config.chatId}` : "已保存 Bot 凭据";
  try {
    const url = new URL(config.webhookUrl ?? "");
    const tail = provider === "wecom" ? url.searchParams.get("key")?.slice(-6) : url.pathname.split("/").pop()?.slice(-6);
    return tail ? `Webhook ···${tail}` : "已保存 Webhook";
  } catch {
    return "已保存加密配置";
  }
}

function publicChannel(row: ChannelRow, config?: NotificationConfig) {
  let events: NotificationEvent[] = [];
  try { events = normalizeEvents(JSON.parse(row.events)); } catch { events = []; }
  return {
    provider: row.provider,
    name: row.name,
    enabled: Boolean(row.enabled),
    configured: Boolean(row.config_ciphertext),
    events,
    configSummary: config ? configSummary(row.provider, config) : "已保存加密配置",
    lastTestAt: row.last_test_at,
    lastTestStatus: row.last_test_status,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

export async function listNotificationSettings(env: Env) {
  const rows = (await env.DB.prepare("SELECT * FROM notification_channels ORDER BY provider").all<ChannelRow>()).results;
  const channels = await Promise.all(rows.map(async (row) => {
    try { return publicChannel(row, await decryptConfig(row.config_ciphertext, env)); }
    catch { return publicChannel(row); }
  }));
  const deliveries = (await env.DB.prepare(`SELECT d.id,d.event_type,d.title,d.status,d.error,d.created_at,c.provider,c.name
    FROM notification_deliveries d JOIN notification_channels c ON c.id=d.channel_id
    ORDER BY d.created_at DESC LIMIT 20`).all()).results;
  return { channels, deliveries };
}

export async function saveNotificationChannel(providerValue: string, body: Record<string, unknown>, env: Env) {
  const provider = providerFrom(providerValue);
  if (!provider) throw new Error("不支持的通知渠道");
  const existing = await env.DB.prepare("SELECT * FROM notification_channels WHERE provider=?").bind(provider).first<ChannelRow>();
  let config: NotificationConfig = {};
  if (existing) config = await decryptConfig(existing.config_ciphertext, env);
  config = { ...config, ...cleanConfig(body.config) };
  validateConfig(provider, config);
  const events = normalizeEvents(body.events);
  const enabled = body.enabled === true ? 1 : 0;
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : providerNames[provider];
  const ciphertext = await encryptConfig(config, env);
  await env.DB.prepare(`INSERT INTO notification_channels (id,provider,name,enabled,events,config_ciphertext)
    VALUES (?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,events=excluded.events,
    config_ciphertext=excluded.config_ciphertext,updated_at=CURRENT_TIMESTAMP`)
    .bind(provider, provider, name, enabled, JSON.stringify(events), ciphertext).run();
  const saved = await env.DB.prepare("SELECT * FROM notification_channels WHERE provider=?").bind(provider).first<ChannelRow>();
  if (!saved) throw new Error("通知渠道保存失败");
  return publicChannel(saved, config);
}

export async function deleteNotificationChannel(providerValue: string, env: Env): Promise<void> {
  const provider = providerFrom(providerValue);
  if (!provider) throw new Error("不支持的通知渠道");
  await env.DB.prepare("DELETE FROM notification_channels WHERE provider=?").bind(provider).run();
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function messageText(payload: NotificationPayload): string {
  return [`【BitWorld · ${eventNames[payload.event]}】`, payload.title, payload.body, payload.detail, payload.url]
    .filter(Boolean).join("\n");
}

async function hmacBase64(keyValue: string, content: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(keyValue), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content))));
}

async function fetchJson(url: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json<Record<string, unknown>>().catch(() => ({}));
  if (!response.ok) throw new Error(`通知服务返回 HTTP ${response.status}`);
  return result;
}

async function deliver(provider: NotificationProvider, config: NotificationConfig, payload: NotificationPayload): Promise<void> {
  validateConfig(provider, config);
  const text = messageText(payload);
  if (provider === "telegram") {
    const result = await fetchJson(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      chat_id: config.chatId,
      text: escapeHtml(text),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(config.topicId ? { message_thread_id: Number(config.topicId) } : {}),
    });
    if (result.ok !== true) throw new Error(typeof result.description === "string" ? result.description : "Telegram 发送失败");
    return;
  }
  if (provider === "feishu") {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = config.secret ? await hmacBase64(`${timestamp}\n${config.secret}`, "") : undefined;
    const result = await fetchJson(validateWebhook(config.webhookUrl, "feishu").toString(), {
      ...(signature ? { timestamp, sign: signature } : {}),
      msg_type: "text",
      content: { text },
    });
    const code = result.code ?? result.StatusCode;
    if (code !== 0 && code !== undefined) throw new Error(String(result.msg ?? result.StatusMessage ?? "飞书发送失败"));
    return;
  }
  const result = await fetchJson(validateWebhook(config.webhookUrl, "wecom").toString(), {
    msgtype: "markdown",
    markdown: { content: text },
  });
  if (result.errcode !== 0) throw new Error(String(result.errmsg ?? "企业微信发送失败"));
}

async function recordDelivery(env: Env, row: ChannelRow, payload: NotificationPayload, status: "success" | "failed", message?: string) {
  await env.DB.prepare("INSERT INTO notification_deliveries (id,channel_id,event_type,title,status,error) VALUES (?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), row.id, payload.event, payload.title.slice(0, 160), status, message?.slice(0, 500) ?? null).run();
}

async function deliverToRow(row: ChannelRow, payload: NotificationPayload, env: Env): Promise<void> {
  try {
    await deliver(row.provider, await decryptConfig(row.config_ciphertext, env), payload);
    await recordDelivery(env, row, payload, "success");
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "未知通知错误";
    await recordDelivery(env, row, payload, "failed", message);
    throw new Error(message);
  }
}

export async function testNotificationChannel(providerValue: string, origin: string, env: Env) {
  const provider = providerFrom(providerValue);
  if (!provider) throw new Error("不支持的通知渠道");
  const row = await env.DB.prepare("SELECT * FROM notification_channels WHERE provider=?").bind(provider).first<ChannelRow>();
  if (!row) throw new Error("请先保存该通知渠道");
  const payload: NotificationPayload = {
    event: "report_published",
    title: `${providerNames[provider]} 通知连接成功`,
    body: "这是一条来自 BitWorld 通知中心的测试消息。",
    detail: "后续公司事件会按照你的订阅规则自动发送。",
    url: origin,
  };
  try {
    await deliverToRow(row, payload, env);
    await env.DB.prepare("UPDATE notification_channels SET last_test_at=CURRENT_TIMESTAMP,last_test_status='success',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id).run();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "测试发送失败";
    await env.DB.prepare("UPDATE notification_channels SET last_test_at=CURRENT_TIMESTAMP,last_test_status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(message.slice(0, 500), row.id).run();
    throw new Error(message);
  }
}

export async function notifyEvent(payload: NotificationPayload, env: Env): Promise<void> {
  const rows = (await env.DB.prepare("SELECT * FROM notification_channels WHERE enabled=1").all<ChannelRow>()).results;
  const selected = rows.filter((row) => {
    try { return normalizeEvents(JSON.parse(row.events)).includes(payload.event); }
    catch { return false; }
  });
  const results = await Promise.allSettled(selected.map((row) => deliverToRow(row, payload, env)));
  for (const result of results) if (result.status === "rejected") console.warn("Notification delivery failed", result.reason);
}
