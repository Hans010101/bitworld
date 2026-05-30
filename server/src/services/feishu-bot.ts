/**
 * Feishu (飞书) Bot Client
 *
 * Handles authentication and message sending via Feishu Open API.
 */
import { logger } from "../middleware/logger.js";

const FEISHU_APP_ID = process.env.FEISHU_APP_ID ?? "";
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET ?? "";
const FEISHU_API = "https://open.feishu.cn/open-apis";

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getTenantAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    throw new Error("FEISHU_APP_ID / FEISHU_APP_SECRET not configured");
  }
  const res = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
  });
  const json = (await res.json()) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (json.code !== 0 || !json.tenant_access_token) {
    throw new Error(`Feishu token error: ${json.msg ?? "unknown"}`);
  }
  cachedToken = {
    token: json.tenant_access_token,
    expiresAt: Date.now() + (json.expire ?? 7200) * 1000 - 60_000,
  };
  return cachedToken.token;
}

export async function sendTextMessage(chatId: string, text: string): Promise<void> {
  const token = await getTenantAccessToken();
  const res = await fetch(`${FEISHU_API}/im/v1/messages?receive_id_type=chat_id`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }) }),
  });
  const json = (await res.json()) as { code?: number; msg?: string };
  if (json.code !== 0) {
    logger.warn({ code: json.code, msg: json.msg }, "[feishu-bot] sendTextMessage failed");
  }
}

/**
 * Hotfix-v20: DM an admin by open_id (no chat_id required). Used by the
 * self-onboarding flow to notify the first admin of a pending join request.
 */
export async function sendDirectMessageToOpenId(openId: string, text: string): Promise<void> {
  const token = await getTenantAccessToken();
  const res = await fetch(`${FEISHU_API}/im/v1/messages?receive_id_type=open_id`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: openId, msg_type: "text", content: JSON.stringify({ text }) }),
  });
  const json = (await res.json()) as { code?: number; msg?: string };
  if (json.code !== 0) {
    logger.warn({ code: json.code, msg: json.msg, openId }, "[feishu-bot] sendDirectMessageToOpenId failed");
  }
}

export async function uploadFile(filename: string, fileBuffer: Buffer, fileType = "pdf"): Promise<string> {
  const token = await getTenantAccessToken();
  const boundary = `----FeishuBoundary${Date.now()}`;
  const parts: Buffer[] = [];
  const addField = (name: string, value: string) => {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  };
  addField("file_type", fileType);
  addField("file_name", filename);
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`));
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  const res = await fetch(`${FEISHU_API}/im/v1/files`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, Authorization: `Bearer ${token}` },
    body,
  });
  const json = (await res.json()) as { code?: number; msg?: string; data?: { file_key?: string } };
  if (json.code !== 0 || !json.data?.file_key) {
    throw new Error(`Feishu upload failed: ${json.msg ?? "unknown"}`);
  }
  return json.data.file_key;
}

export async function sendFileMessage(chatId: string, fileKey: string): Promise<void> {
  const token = await getTenantAccessToken();
  const res = await fetch(`${FEISHU_API}/im/v1/messages?receive_id_type=chat_id`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: chatId, msg_type: "file", content: JSON.stringify({ file_key: fileKey }) }),
  });
  const json = (await res.json()) as { code?: number; msg?: string };
  if (json.code !== 0) {
    logger.warn({ code: json.code, msg: json.msg }, "[feishu-bot] sendFileMessage failed");
  }
}
