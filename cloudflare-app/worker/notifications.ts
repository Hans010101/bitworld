import { briefDefinitions, briefMenuVersion } from "./briefs";

export type NotificationProvider = "telegram" | "feishu" | "wecom";
export type NotificationEvent = "task_completed" | "report_published" | "run_failed" | "approval_decided";

type NotificationConfig = Record<string, string>;

type ChannelRow = {
  id: string;
  user_id: string;
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

export type InboundBotMessage = {
  channelId: string;
  userId: string;
  provider: "telegram" | "feishu";
  externalMessageId: string;
  conversationId: string;
  senderId: string | null;
  text: string;
};

export type InboundWebhookResult =
  | { kind: "challenge"; challenge: string }
  | { kind: "ignored" }
  | { kind: "message"; message: InboundBotMessage };

function isScheduledDelivery(message: InboundBotMessage): boolean {
  return message.externalMessageId.startsWith("schedule:");
}

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
    if (config.appId || config.appSecret || config.receiveId) {
      if (!/^cli_[A-Za-z0-9]+$/.test(config.appId ?? "")) throw new Error("飞书 App ID 格式不正确");
      if ((config.appSecret ?? "").length < 20) throw new Error("飞书 App Secret 格式不正确");
      if (!(config.receiveId ?? "")) throw new Error("请输入飞书接收人或群组 ID");
      if (!["open_id", "union_id", "user_id", "email", "chat_id"].includes(config.receiveIdType ?? "user_id")) {
        throw new Error("飞书接收 ID 类型不受支持");
      }
    } else {
      validateWebhook(config.webhookUrl ?? "", "feishu");
    }
  } else {
    validateWebhook(config.webhookUrl ?? "", "wecom");
  }
}

function configSummary(provider: NotificationProvider, config: NotificationConfig): string {
  if (provider === "telegram") return config.chatId ? `目标 ${config.chatId}` : "已保存 Bot 凭据";
  if (provider === "feishu" && config.appId) {
    const tail = config.receiveId?.slice(-6);
    return tail ? `应用机器人 · 接收目标 ···${tail}` : "已保存应用机器人凭据";
  }
  try {
    const url = new URL(config.webhookUrl ?? "");
    const tail = provider === "wecom" ? url.searchParams.get("key")?.slice(-6) : url.pathname.split("/").pop()?.slice(-6);
    return tail ? `Webhook ···${tail}` : "已保存 Webhook";
  } catch {
    return "已保存加密配置";
  }
}

function publicChannel(row: ChannelRow, env: Env, config?: NotificationConfig) {
  let events: NotificationEvent[] = [];
  try { events = normalizeEvents(JSON.parse(row.events)); } catch { events = []; }
  const callbackPath = row.provider === "telegram" || (row.provider === "feishu" && config?.appId)
    ? `/webhooks/${row.provider}/${row.id}`
    : null;
  return {
    provider: row.provider,
    name: row.name,
    enabled: Boolean(row.enabled),
    configured: Boolean(row.config_ciphertext),
    configMode: row.provider === "feishu" ? (config?.appId ? "app" : "webhook") : null,
    inboundConfigured: row.provider === "telegram"
      ? Boolean(config?.webhookSecret)
      : row.provider === "feishu" && Boolean(config?.appId)
        ? Boolean(config?.verificationToken)
        : false,
    callbackPath,
    callbackUrl: callbackPath
      ? row.provider === "feishu"
        ? `${env.FEISHU_CALLBACK_ORIGIN.replace(/\/$/, "")}${callbackPath}`
        : callbackPath
      : null,
    events,
    configSummary: config ? configSummary(row.provider, config) : "已保存加密配置",
    lastTestAt: row.last_test_at,
    lastTestStatus: row.last_test_status,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

export async function listNotificationSettings(userId: string, env: Env) {
  const rows = (await env.DB.prepare("SELECT * FROM notification_channels WHERE user_id=? ORDER BY provider").bind(userId).all<ChannelRow>()).results;
  const channels = await Promise.all(rows.map(async (row) => {
    try { return publicChannel(row, env, await decryptConfig(row.config_ciphertext, env)); }
    catch { return publicChannel(row, env); }
  }));
  const deliveries = (await env.DB.prepare(`SELECT d.id,d.event_type,d.title,d.status,d.error,d.created_at,c.provider,c.name
    FROM notification_deliveries d JOIN notification_channels c ON c.id=d.channel_id
    WHERE c.user_id=? ORDER BY d.created_at DESC LIMIT 20`).bind(userId).all()).results;
  return { channels, deliveries };
}

export async function saveNotificationChannel(providerValue: string, body: Record<string, unknown>, userId: string, env: Env) {
  const provider = providerFrom(providerValue);
  if (!provider) throw new Error("不支持的通知渠道");
  const existing = await env.DB.prepare("SELECT * FROM notification_channels WHERE user_id=? AND provider=?").bind(userId, provider).first<ChannelRow>();
  let config: NotificationConfig = {};
  if (existing) config = await decryptConfig(existing.config_ciphertext, env);
  const incoming = cleanConfig(body.config);
  if (provider === "feishu" && body.mode === "app") {
    config = {
      appId: incoming.appId ?? config.appId ?? "",
      appSecret: incoming.appSecret ?? config.appSecret ?? "",
      receiveId: incoming.receiveId ?? config.receiveId ?? "",
      receiveIdType: incoming.receiveIdType ?? config.receiveIdType ?? "user_id",
      verificationToken: incoming.verificationToken ?? config.verificationToken ?? "",
    };
  } else if (provider === "feishu" && body.mode === "webhook") {
    config = {
      webhookUrl: incoming.webhookUrl ?? config.webhookUrl ?? "",
      secret: incoming.secret ?? config.secret ?? "",
    };
  } else {
    config = { ...config, ...incoming };
  }
  validateConfig(provider, config);
  const events = normalizeEvents(body.events);
  const enabled = body.enabled === true ? 1 : 0;
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : providerNames[provider];
  const ciphertext = await encryptConfig(config, env);
  await env.DB.prepare(`INSERT INTO notification_channels (id,user_id,provider,name,enabled,events,config_ciphertext)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,events=excluded.events,
    config_ciphertext=excluded.config_ciphertext,updated_at=CURRENT_TIMESTAMP`)
    .bind(crypto.randomUUID(), userId, provider, name, enabled, JSON.stringify(events), ciphertext).run();
  const saved = await env.DB.prepare("SELECT * FROM notification_channels WHERE user_id=? AND provider=?").bind(userId, provider).first<ChannelRow>();
  if (!saved) throw new Error("通知渠道保存失败");
  await env.DB.prepare("DELETE FROM bot_navigation_state WHERE channel_id=?").bind(saved.id).run();
  return publicChannel(saved, env, config);
}

export async function deleteNotificationChannel(providerValue: string, userId: string, env: Env): Promise<void> {
  const provider = providerFrom(providerValue);
  if (!provider) throw new Error("不支持的通知渠道");
  await env.DB.prepare("DELETE FROM notification_channels WHERE user_id=? AND provider=?").bind(userId, provider).run();
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

async function fetchJson(url: string, payload: unknown, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json<Record<string, unknown>>().catch(() => ({}));
  if (!response.ok) throw new Error(`通知服务返回 HTTP ${response.status}`);
  return result;
}

async function fetchForm(
  url: string,
  form: FormData,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json<Record<string, unknown>>().catch(() => ({}));
  if (!response.ok) throw new Error(`通知服务返回 HTTP ${response.status}`);
  return result;
}

function randomWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function secureTextEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  return (crypto.subtle as SubtleCrypto & { timingSafeEqual(a: BufferSource, b: BufferSource): boolean })
    .timingSafeEqual(leftHash, rightHash);
}

async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 256_000) throw new Error("回调消息过大");
  const text = await request.text();
  if (text.length > 256_000) throw new Error("回调消息过大");
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("回调格式无效");
  return parsed as Record<string, unknown>;
}

async function inboundChannel(channelId: string, provider: "telegram" | "feishu", env: Env) {
  const row = await env.DB.prepare("SELECT * FROM notification_channels WHERE id=? AND provider=? AND enabled=1")
    .bind(channelId, provider).first<ChannelRow>();
  if (!row) throw new Error("回调渠道不存在或未启用");
  return { row, config: await decryptConfig(row.config_ciphertext, env) };
}

export async function acceptTelegramWebhook(request: Request, channelId: string, env: Env): Promise<InboundWebhookResult> {
  const { row, config } = await inboundChannel(channelId, "telegram", env);
  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!config.webhookSecret || !suppliedSecret || !await secureTextEqual(suppliedSecret, config.webhookSecret)) {
    throw new Error("Telegram 回调校验失败");
  }
  const body = await boundedJson(request);
  const candidate = body.message ?? body.edited_message;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { kind: "ignored" };
  const message = candidate as Record<string, unknown>;
  const chat = message.chat;
  const sender = message.from;
  if (!chat || typeof chat !== "object" || Array.isArray(chat)) return { kind: "ignored" };
  const chatId = String((chat as Record<string, unknown>).id ?? "");
  if (!chatId || chatId !== config.chatId) throw new Error("Telegram 会话未获该账号授权");
  if (typeof message.text !== "string" || !message.text.trim()) return { kind: "ignored" };
  if (sender && typeof sender === "object" && !Array.isArray(sender) && (sender as Record<string, unknown>).is_bot === true) {
    return { kind: "ignored" };
  }
  const messageId = String(message.message_id ?? "");
  if (!messageId) return { kind: "ignored" };
  return {
    kind: "message",
    message: {
      channelId: row.id,
      userId: row.user_id,
      provider: "telegram",
      externalMessageId: messageId,
      conversationId: chatId,
      senderId: sender && typeof sender === "object" && !Array.isArray(sender)
        ? String((sender as Record<string, unknown>).id ?? "") || null
        : null,
      text: message.text.trim().slice(0, 12_000),
    },
  };
}

export async function acceptFeishuWebhook(request: Request, channelId: string, env: Env): Promise<InboundWebhookResult> {
  const { row, config } = await inboundChannel(channelId, "feishu", env);
  if (!config.appId || !config.verificationToken) throw new Error("飞书入站回调尚未配置");
  const body = await boundedJson(request);
  if (typeof body.challenge === "string") {
    const challengeHeader = body.header;
    const headerValue = challengeHeader && typeof challengeHeader === "object" && !Array.isArray(challengeHeader)
      ? challengeHeader as Record<string, unknown>
      : null;
    const suppliedToken = typeof body.token === "string"
      ? body.token
      : typeof headerValue?.token === "string"
        ? headerValue.token
        : "";
    if (!suppliedToken || !await secureTextEqual(suppliedToken, config.verificationToken)) {
      throw new Error("飞书回调校验失败");
    }
    if (headerValue?.app_id && headerValue.app_id !== config.appId) throw new Error("飞书应用标识不匹配");
    return { kind: "challenge", challenge: body.challenge };
  }
  const header = body.header;
  const event = body.event;
  if (!header || typeof header !== "object" || Array.isArray(header) || !event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("飞书事件格式无效");
  }
  const headerValue = header as Record<string, unknown>;
  if (typeof headerValue.token !== "string" || !await secureTextEqual(headerValue.token, config.verificationToken)) {
    throw new Error("飞书回调校验失败");
  }
  if (headerValue.app_id !== config.appId) return { kind: "ignored" };
  const eventValue = event as Record<string, unknown>;
  if (headerValue.event_type === "card.action.trigger") {
    const action = eventValue.action;
    const context = eventValue.context;
    const operator = eventValue.operator;
    if (!action || typeof action !== "object" || Array.isArray(action)) return { kind: "ignored" };
    const actionValue = (action as Record<string, unknown>).value;
    if (!actionValue || typeof actionValue !== "object" || Array.isArray(actionValue)) return { kind: "ignored" };
    const briefId = (actionValue as Record<string, unknown>).brief_id;
    if (typeof briefId !== "string" || !briefDefinitions.some((brief) => brief.id === briefId)) return { kind: "ignored" };
    const contextValue = context && typeof context === "object" && !Array.isArray(context)
      ? context as Record<string, unknown>
      : {};
    const operatorValue = operator && typeof operator === "object" && !Array.isArray(operator)
      ? operator as Record<string, unknown>
      : {};
    const operatorId = operatorValue.operator_id;
    const operatorIds = operatorId && typeof operatorId === "object" && !Array.isArray(operatorId)
      ? operatorId as Record<string, unknown>
      : operatorValue;
    const conversationId = String(contextValue.open_chat_id ?? config.receiveId ?? "");
    if (!conversationId) return { kind: "ignored" };
    const configuredType = config.receiveIdType ?? "user_id";
    if (
      configuredType === "chat_id"
      && config.receiveId
      && conversationId !== config.receiveId
    ) throw new Error("飞书会话未获该账号授权");
    if (
      configuredType !== "chat_id"
      && config.receiveId
      && operatorIds[configuredType]
      && operatorIds[configuredType] !== config.receiveId
    ) throw new Error("飞书操作者未获该账号授权");
    const externalMessageId = String(headerValue.event_id ?? contextValue.open_message_id ?? "");
    if (!externalMessageId) return { kind: "ignored" };
    return {
      kind: "message",
      message: {
        channelId: row.id,
        userId: row.user_id,
        provider: "feishu",
        externalMessageId,
        conversationId,
        senderId: String(operatorIds.user_id ?? operatorIds.open_id ?? "") || null,
        text: `brief:${briefId}`,
      },
    };
  }
  if (headerValue.event_type !== "im.message.receive_v1") return { kind: "ignored" };
  const message = eventValue.message;
  const sender = eventValue.sender;
  if (!message || typeof message !== "object" || Array.isArray(message)) return { kind: "ignored" };
  if (sender && typeof sender === "object" && !Array.isArray(sender) && (sender as Record<string, unknown>).sender_type === "app") {
    return { kind: "ignored" };
  }
  const messageValue = message as Record<string, unknown>;
  if (messageValue.message_type !== "text" || typeof messageValue.content !== "string") return { kind: "ignored" };
  let content: unknown;
  try { content = JSON.parse(messageValue.content); } catch { return { kind: "ignored" }; }
  if (!content || typeof content !== "object" || Array.isArray(content) || typeof (content as Record<string, unknown>).text !== "string") {
    return { kind: "ignored" };
  }
  const senderId = sender && typeof sender === "object" && !Array.isArray(sender)
    ? (sender as Record<string, unknown>).sender_id
    : null;
  const senderIds = senderId && typeof senderId === "object" && !Array.isArray(senderId)
    ? senderId as Record<string, unknown>
    : {};
  const configuredType = config.receiveIdType ?? "user_id";
  if (configuredType !== "chat_id" && config.receiveId && senderIds[configuredType] !== config.receiveId) {
    throw new Error("飞书发送者未获该账号授权");
  }
  const messageId = String(messageValue.message_id ?? "");
  const conversationId = String(messageValue.chat_id ?? "");
  if (!messageId || !conversationId) return { kind: "ignored" };
  return {
    kind: "message",
    message: {
      channelId: row.id,
      userId: row.user_id,
      provider: "feishu",
      externalMessageId: messageId,
      conversationId,
      senderId: String(senderIds.user_id ?? senderIds.open_id ?? "") || null,
      text: (content as { text: string }).text.trim().slice(0, 12_000),
    },
  };
}

export async function registerTelegramWebhook(userId: string, origin: string, env: Env) {
  const row = await env.DB.prepare("SELECT * FROM notification_channels WHERE user_id=? AND provider='telegram'")
    .bind(userId).first<ChannelRow>();
  if (!row) throw new Error("请先保存 Telegram 配置");
  const config = await decryptConfig(row.config_ciphertext, env);
  validateConfig("telegram", config);
  const webhookSecret = config.webhookSecret || randomWebhookSecret();
  const webhookUrl = `${origin}/webhooks/telegram/${row.id}`;
  const result = await fetchJson(`https://api.telegram.org/bot${config.botToken}/setWebhook`, {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  if (result.ok !== true) throw new Error(typeof result.description === "string" ? result.description : "Telegram Webhook 注册失败");
  const nextConfig = { ...config, webhookSecret };
  await env.DB.prepare("UPDATE notification_channels SET config_ciphertext=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(await encryptConfig(nextConfig, env), row.id).run();
  await env.DB.prepare("DELETE FROM bot_navigation_state WHERE channel_id=?").bind(row.id).run();
  return { ok: true, callbackPath: `/webhooks/telegram/${row.id}` };
}

async function feishuTenantToken(config: NotificationConfig): Promise<string> {
  const tokenResult = await fetchJson("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    app_id: config.appId,
    app_secret: config.appSecret,
  });
  if (tokenResult.code !== 0 || typeof tokenResult.tenant_access_token !== "string") {
    throw new Error(String(tokenResult.msg ?? "飞书应用凭证校验失败"));
  }
  return tokenResult.tenant_access_token;
}

export async function sendInboundReply(message: InboundBotMessage, textValue: string, env: Env): Promise<void> {
  const { config } = await inboundChannel(message.channelId, message.provider, env);
  if (message.provider === "telegram") {
    const text = textValue.slice(0, 4000);
    const result = await fetchJson(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      chat_id: message.conversationId,
      text,
      disable_web_page_preview: true,
      ...(!isScheduledDelivery(message)
        ? { reply_parameters: { message_id: Number(message.externalMessageId), allow_sending_without_reply: true } }
        : {}),
    });
    if (result.ok !== true) throw new Error(typeof result.description === "string" ? result.description : "Telegram 回复失败");
    return;
  }
  const token = await feishuTenantToken(config);
  const result = isScheduledDelivery(message)
    ? await fetchJson(
        `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(config.receiveIdType ?? "user_id")}`,
        {
          receive_id: message.conversationId,
          msg_type: "text",
          content: JSON.stringify({ text: textValue.slice(0, 6000) }),
        },
        { authorization: `Bearer ${token}` },
      )
    : await fetchJson(
        `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(message.externalMessageId)}/reply`,
        { msg_type: "text", content: JSON.stringify({ text: textValue.slice(0, 6000) }) },
        { authorization: `Bearer ${token}` },
      );
  if (result.code !== 0) throw new Error(String(result.msg ?? "飞书应用机器人回复失败"));
}

function feishuBriefCard(): Record<string, unknown> {
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: {
      title: { tag: "plain_text", content: "BitWorld 简报中心" },
      subtitle: { tag: "plain_text", content: "选择主题，立即生成专业摘要与 PDF 完整报告" },
      template: "red",
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 12px 12px",
      elements: [
        {
          tag: "markdown",
          content: "**按需生成 · 实时检索 · 专业质检**\n点击后由董秘立即发起任务，完成后会在当前会话直接发送核心摘要和 PDF 文件。",
          text_size: "normal",
        },
        ...briefDefinitions.map((brief) => ({
          tag: "button",
          text: { tag: "plain_text", content: brief.label },
          type: "primary",
          width: "fill",
          size: "medium",
          behaviors: [{ type: "callback", value: { brief_id: brief.id } }],
        })),
      ],
    },
  };
}

export async function sendBriefMenu(message: InboundBotMessage, env: Env): Promise<void> {
  const { config } = await inboundChannel(message.channelId, message.provider, env);
  if (message.provider === "telegram") {
    const result = await fetchJson(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      chat_id: message.conversationId,
      text: "【BitWorld 简报中心】\n选择一个主题，系统会立即检索最新信息，完成专业质检后发送摘要与 PDF 完整报告。",
      disable_web_page_preview: true,
      reply_markup: {
        keyboard: [
          briefDefinitions.slice(0, 2).map((brief) => ({ text: brief.label })),
          briefDefinitions.slice(2, 4).map((brief) => ({ text: brief.label })),
          briefDefinitions.slice(4, 6).map((brief) => ({ text: brief.label })),
        ],
        resize_keyboard: true,
        is_persistent: true,
        input_field_placeholder: "请选择简报，或直接输入任务",
      },
      ...(!isScheduledDelivery(message)
        ? { reply_parameters: { message_id: Number(message.externalMessageId), allow_sending_without_reply: true } }
        : {}),
    });
    if (result.ok !== true) throw new Error(typeof result.description === "string" ? result.description : "Telegram 简报导航发送失败");
    return;
  }
  const token = await feishuTenantToken(config);
  const content = JSON.stringify(feishuBriefCard());
  const result = isScheduledDelivery(message)
    ? await fetchJson(
        `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(config.receiveIdType ?? "user_id")}`,
        { receive_id: message.conversationId, msg_type: "interactive", content },
        { authorization: `Bearer ${token}` },
      )
    : await fetchJson(
        `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(message.externalMessageId)}/reply`,
        { msg_type: "interactive", content },
        { authorization: `Bearer ${token}` },
      );
  if (result.code !== 0) throw new Error(String(result.msg ?? "飞书简报导航发送失败"));
}

async function installTelegramCommands(config: NotificationConfig): Promise<void> {
  const result = await fetchJson(`https://api.telegram.org/bot${config.botToken}/setMyCommands`, {
    commands: [
      { command: "menu", description: "打开 BitWorld 简报中心" },
      ...briefDefinitions.map((brief) => ({ command: brief.command, description: brief.title })),
    ],
  });
  if (result.ok !== true) throw new Error(typeof result.description === "string" ? result.description : "Telegram 命令菜单配置失败");
}

export async function syncPendingBotNavigations(env: Env): Promise<number> {
  const rows = (await env.DB.prepare(`SELECT c.*
    FROM notification_channels c
    LEFT JOIN bot_navigation_state n ON n.channel_id=c.id
    WHERE c.enabled=1
      AND c.provider IN ('telegram','feishu')
      AND (n.channel_id IS NULL OR n.menu_version<>? OR n.synced_at IS NULL)
    ORDER BY c.updated_at
    LIMIT 10`).bind(briefMenuVersion).all<ChannelRow>()).results;
  let synced = 0;
  for (const row of rows) {
    if (row.provider !== "telegram" && row.provider !== "feishu") continue;
    try {
      const config = await decryptConfig(row.config_ciphertext, env);
      const conversationId = row.provider === "telegram" ? config.chatId : config.receiveId;
      if (!conversationId || (row.provider === "feishu" && (!config.appId || !config.appSecret))) {
        throw new Error("当前渠道不支持交互式简报导航");
      }
      if (row.provider === "telegram") await installTelegramCommands(config);
      await sendBriefMenu({
        channelId: row.id,
        userId: row.user_id,
        provider: row.provider,
        externalMessageId: `schedule:navigation:${briefMenuVersion}`,
        conversationId,
        senderId: null,
        text: "/menu",
      }, env);
      await env.DB.prepare(`INSERT INTO bot_navigation_state
        (channel_id,menu_version,synced_at,last_error,updated_at)
        VALUES (?,?,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP)
        ON CONFLICT(channel_id) DO UPDATE SET
          menu_version=excluded.menu_version,
          synced_at=CURRENT_TIMESTAMP,
          last_error=NULL,
          updated_at=CURRENT_TIMESTAMP`)
        .bind(row.id, briefMenuVersion).run();
      synced += 1;
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "未知导航配置错误";
      await env.DB.prepare(`INSERT INTO bot_navigation_state
        (channel_id,menu_version,synced_at,last_error,updated_at)
        VALUES (?,?,NULL,?,CURRENT_TIMESTAMP)
        ON CONFLICT(channel_id) DO UPDATE SET
          menu_version=excluded.menu_version,
          synced_at=NULL,
          last_error=excluded.last_error,
          updated_at=CURRENT_TIMESTAMP`)
        .bind(row.id, briefMenuVersion, reason.slice(0, 500)).run();
      console.warn(JSON.stringify({
        event: "bot_navigation_sync_failed",
        channelId: row.id,
        provider: row.provider,
        reason: reason.slice(0, 240),
      }));
    }
  }
  return synced;
}

export async function sendInboundDocument(
  message: InboundBotMessage,
  fileBytes: Uint8Array,
  fileName: string,
  captionValue: string,
  env: Env,
): Promise<void> {
  if (!fileBytes.byteLength) throw new Error("待发送的 PDF 文件为空");
  const { config } = await inboundChannel(message.channelId, message.provider, env);
  const safeFileName = fileName.replace(/[\\/:*?"<>|]/g, "-").slice(0, 120) || "完整报告.pdf";
  const fileBuffer = new ArrayBuffer(fileBytes.byteLength);
  new Uint8Array(fileBuffer).set(fileBytes);
  const fileBlob = new Blob([fileBuffer], { type: "application/pdf" });
  if (message.provider === "telegram") {
    const form = new FormData();
    form.set("chat_id", message.conversationId);
    form.set("document", fileBlob, safeFileName);
    form.set("caption", captionValue.slice(0, 1000));
    if (!isScheduledDelivery(message)) {
      form.set("reply_parameters", JSON.stringify({
        message_id: Number(message.externalMessageId),
        allow_sending_without_reply: true,
      }));
    }
    const result = await fetchForm(`https://api.telegram.org/bot${config.botToken}/sendDocument`, form);
    if (result.ok !== true) throw new Error(typeof result.description === "string" ? result.description : "Telegram PDF 发送失败");
    return;
  }

  const token = await feishuTenantToken(config);
  const uploadForm = new FormData();
  uploadForm.set("file_type", "pdf");
  uploadForm.set("file_name", safeFileName);
  uploadForm.set("file", fileBlob, safeFileName);
  const uploaded = await fetchForm(
    "https://open.feishu.cn/open-apis/im/v1/files",
    uploadForm,
    { authorization: `Bearer ${token}` },
  );
  const uploadData = uploaded.data && typeof uploaded.data === "object" && !Array.isArray(uploaded.data)
    ? uploaded.data as Record<string, unknown>
    : null;
  if (uploaded.code !== 0 || typeof uploadData?.file_key !== "string") {
    throw new Error(String(uploaded.msg ?? "飞书 PDF 上传失败"));
  }
  const result = isScheduledDelivery(message)
    ? await fetchJson(
        `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(config.receiveIdType ?? "user_id")}`,
        {
          receive_id: message.conversationId,
          msg_type: "file",
          content: JSON.stringify({ file_key: uploadData.file_key }),
        },
        { authorization: `Bearer ${token}` },
      )
    : await fetchJson(
        `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(message.externalMessageId)}/reply`,
        { msg_type: "file", content: JSON.stringify({ file_key: uploadData.file_key }) },
        { authorization: `Bearer ${token}` },
      );
  if (result.code !== 0) throw new Error(String(result.msg ?? "飞书 PDF 回复失败"));
}

export async function scheduledDeliveryContext(
  userId: string,
  provider: "telegram" | "feishu",
  occurrenceId: string,
  env: Env,
): Promise<InboundBotMessage> {
  const row = await env.DB.prepare(`SELECT * FROM notification_channels
    WHERE user_id=? AND provider=? AND enabled=1`)
    .bind(userId, provider).first<ChannelRow>();
  if (!row) throw new Error(`当前账号尚未启用${providerNames[provider]}发送渠道`);
  const config = await decryptConfig(row.config_ciphertext, env);
  validateConfig(provider, config);
  if (provider === "feishu" && !config.appId) {
    throw new Error("飞书定时报送需要使用应用机器人模式，群 Webhook 无法发送 PDF 文件");
  }
  const conversationId = provider === "telegram" ? config.chatId : config.receiveId;
  if (!conversationId) throw new Error(`${providerNames[provider]}未配置接收目标`);
  return {
    channelId: row.id,
    userId,
    provider,
    externalMessageId: `schedule:${occurrenceId}`,
    conversationId,
    senderId: null,
    text: "",
  };
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
    if (config.appId) {
      const tokenResult = await fetchJson("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        app_id: config.appId,
        app_secret: config.appSecret,
      });
      if (tokenResult.code !== 0 || typeof tokenResult.tenant_access_token !== "string") {
        throw new Error(String(tokenResult.msg ?? "飞书应用凭证校验失败"));
      }
      const receiveIdType = config.receiveIdType ?? "user_id";
      const result = await fetchJson(
        `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
        {
          receive_id: config.receiveId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        },
        { authorization: `Bearer ${tokenResult.tenant_access_token}` },
      );
      if (result.code !== 0) throw new Error(String(result.msg ?? "飞书应用机器人发送失败"));
      return;
    }
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

export async function testNotificationChannel(providerValue: string, origin: string, userId: string, env: Env) {
  const provider = providerFrom(providerValue);
  if (!provider) throw new Error("不支持的通知渠道");
  const row = await env.DB.prepare("SELECT * FROM notification_channels WHERE user_id=? AND provider=?").bind(userId, provider).first<ChannelRow>();
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

export async function notifyEvent(payload: NotificationPayload, userId: string, env: Env): Promise<void> {
  const rows = (await env.DB.prepare("SELECT * FROM notification_channels WHERE user_id=? AND enabled=1")
    .bind(userId).all<ChannelRow>()).results;
  const selected = rows.filter((row) => {
    try { return normalizeEvents(JSON.parse(row.events)).includes(payload.event); }
    catch { return false; }
  });
  const results = await Promise.allSettled(selected.map((row) => deliverToRow(row, payload, env)));
  for (const result of results) if (result.status === "rejected") console.warn("Notification delivery failed", result.reason);
}
