# Paperclip Agent JWT Token - 关键代码片段

## 1. JWT 创建 (核心实现)

**文件**: `/Users/hans.pan/paperclip/server/src/agent-auth-jwt.ts`

```typescript
/**
 * 生成本地 agent JWT token
 * @param agentId - Agent 唯一标识符
 * @param companyId - Company 唯一标识符
 * @param adapterType - Adapter 类型 (e.g., "claude_local", "codex_local")
 * @param runId - Heartbeat run 唯一标识符
 * @returns JWT token 字符串，或 null 如果 secret 未配置
 */
export function createLocalAgentJwt(
  agentId: string, 
  companyId: string, 
  adapterType: string, 
  runId: string
): string | null {
  const config = jwtConfig();
  if (!config) return null;  // 没有 JWT secret 时返回 null

  const now = Math.floor(Date.now() / 1000);
  
  // 构造 JWT claims (payload)
  const claims: LocalAgentJwtClaims = {
    sub: agentId,                                    // Subject - 识别 agent
    company_id: companyId,                          // Company 关联
    adapter_type: adapterType,                      // Adapter 类型
    run_id: runId,                                  // Heartbeat run ID
    iat: now,                                       // Issued at - 签发时间
    exp: now + config.ttlSeconds,                  // Expiration - 过期时间
    iss: config.issuer,                            // Issuer - 签发者
    aud: config.audience,                          // Audience - 预期接收者
  };

  // JWT Header
  const header = {
    alg: JWT_ALGORITHM,                            // "HS256"
    typ: "JWT",
  };

  // 构造签名输入: header.payload
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  
  // 使用 HMAC-SHA256 签名
  const signature = signPayload(config.secret, signingInput);

  // 返回完整 JWT: header.payload.signature
  return `${signingInput}.${signature}`;
}

// 辅助函数：签名
function signPayload(secret: string, signingInput: string) {
  return createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
}

// 辅助函数：Base64URL 编码
function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}
```

## 2. JWT 验证 (核心实现)

**文件**: `/Users/hans.pan/paperclip/server/src/agent-auth-jwt.ts`

```typescript
/**
 * 验证本地 agent JWT token
 * @param token - JWT token 字符串
 * @returns 如果有效返回 claims 对象，否则返回 null
 */
export function verifyLocalAgentJwt(token: string): LocalAgentJwtClaims | null {
  if (!token) return null;
  
  const config = jwtConfig();
  if (!config) return null;

  // 1. 解析 JWT 格式: header.payload.signature
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  
  const [headerB64, claimsB64, signature] = parts;

  // 2. 验证 header
  const header = parseJson(base64UrlDecode(headerB64));
  if (!header || header.alg !== JWT_ALGORITHM) return null;

  // 3. 验证签名 (使用 timing-safe 比较防止时序攻击)
  const signingInput = `${headerB64}.${claimsB64}`;
  const expectedSig = signPayload(config.secret, signingInput);
  
  if (!safeCompare(signature, expectedSig)) {
    return null;  // 签名不匹配 -> 拒绝
  }

  // 4. 解析 claims
  const claims = parseJson(base64UrlDecode(claimsB64));
  if (!claims) return null;

  // 5. 验证所有必需的 claims
  const sub = typeof claims.sub === "string" ? claims.sub : null;
  const companyId = typeof claims.company_id === "string" ? claims.company_id : null;
  const adapterType = typeof claims.adapter_type === "string" ? claims.adapter_type : null;
  const runId = typeof claims.run_id === "string" ? claims.run_id : null;
  const iat = typeof claims.iat === "number" ? claims.iat : null;
  const exp = typeof claims.exp === "number" ? claims.exp : null;
  
  if (!sub || !companyId || !adapterType || !runId || !iat || !exp) {
    return null;  // 必需字段缺失 -> 拒绝
  }

  // 6. 验证过期时间
  const now = Math.floor(Date.now() / 1000);
  if (exp < now) {
    return null;  // Token 已过期 -> 拒绝
  }

  // 7. 验证 issuer 和 audience (可选)
  const issuer = typeof claims.iss === "string" ? claims.iss : undefined;
  const audience = typeof claims.aud === "string" ? claims.aud : undefined;
  
  if (issuer && issuer !== config.issuer) return null;
  if (audience && audience !== config.audience) return null;

  // 8. 返回有效的 claims
  return {
    sub,
    company_id: companyId,
    adapter_type: adapterType,
    run_id: runId,
    iat,
    exp,
    ...(issuer ? { iss: issuer } : {}),
    ...(audience ? { aud: audience } : {}),
    jti: typeof claims.jti === "string" ? claims.jti : undefined,
  };
}

// 辅助函数：Timing-safe 比较 (防止时序攻击)
function safeCompare(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  // 使用 Node.js 提供的 timing-safe 比较
  return timingSafeEqual(left, right);
}
```

## 3. JWT 配置读取

**文件**: `/Users/hans.pan/paperclip/server/src/agent-auth-jwt.ts`

```typescript
interface JwtConfig {
  secret: string;
  ttlSeconds: number;
  issuer: string;
  audience: string;
}

function jwtConfig(): JwtConfig | null {
  const secret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  if (!secret) return null;

  return {
    secret,
    // 默认 48 小时有效期
    ttlSeconds: parseNumber(
      process.env.PAPERCLIP_AGENT_JWT_TTL_SECONDS, 
      60 * 60 * 48
    ),
    // 默认 issuer
    issuer: process.env.PAPERCLIP_AGENT_JWT_ISSUER ?? "paperclip",
    // 默认 audience
    audience: process.env.PAPERCLIP_AGENT_JWT_AUDIENCE ?? "paperclip-api",
  };
}
```

## 4. JWT Secret 管理 (CLI 侧)

**文件**: `/Users/hans.pan/paperclip/cli/src/config/env.ts`

```typescript
import { randomBytes } from "node:crypto";

const JWT_SECRET_ENV_KEY = "PAPERCLIP_AGENT_JWT_SECRET";

/**
 * 确保 JWT Secret 存在 (自动生成或读取现有)
 */
export function ensureAgentJwtSecret(
  configPath?: string
): { secret: string; created: boolean } {
  // 1. 尝试从环境变量读取
  const existingEnv = readAgentJwtSecretFromEnv(configPath);
  if (existingEnv) {
    return { secret: existingEnv, created: false };
  }

  // 2. 尝试从文件读取
  const envFilePath = resolveEnvFilePath(configPath);
  const existingFile = readAgentJwtSecretFromEnvFile(envFilePath);
  
  // 3. 生成新 secret 或使用现有
  // randomBytes(32) = 256-bit 随机值
  // .toString("hex") = 转换为 64 字符十六进制字符串
  const secret = existingFile ?? randomBytes(32).toString("hex");
  const created = !existingFile;

  // 4. 如果是新生成的，写入文件
  if (!existingFile) {
    writeAgentJwtEnv(secret, envFilePath);
  }

  return { secret, created };
}

/**
 * 从环境变量读取 JWT Secret (加载 .env 文件)
 */
export function readAgentJwtSecretFromEnv(configPath?: string): string | null {
  loadAgentJwtEnvFile(resolveEnvFilePath(configPath));
  const raw = process.env[JWT_SECRET_ENV_KEY];
  return isNonEmpty(raw) ? raw!.trim() : null;
}

/**
 * 从文件读取 JWT Secret
 */
export function readAgentJwtSecretFromEnvFile(
  filePath = resolveEnvFilePath()
): string | null {
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const values = parseEnvFile(raw);
  const value = values[JWT_SECRET_ENV_KEY];
  return isNonEmpty(value) ? value!.trim() : null;
}

/**
 * 写入 JWT Secret 到文件
 */
export function writeAgentJwtEnv(
  secret: string, 
  filePath = resolveEnvFilePath()
): void {
  mergePaperclipEnvEntries({ [JWT_SECRET_ENV_KEY]: secret }, filePath);
}
```

## 5. JWT Token 在 Heartbeat 中的生成

**文件**: `/Users/hans.pan/paperclip/server/src/services/heartbeat.ts` (第 1846-1868 行)

```typescript
// 在 startHeartbeatRun() 中:

const adapter = getServerAdapter(agent.adapterType);

// 检查此 adapter 是否支持本地 JWT
const authToken = adapter.supportsLocalAgentJwt
  ? createLocalAgentJwt(
      agent.id,           // Agent ID
      agent.companyId,    // Company ID
      agent.adapterType,  // Adapter type
      run.id              // Heartbeat run ID
    )
  : null;

// 如果支持但 secret 未配置，记录警告
if (adapter.supportsLocalAgentJwt && !authToken) {
  logger.warn(
    {
      companyId: agent.companyId,
      agentId: agent.id,
      runId: run.id,
      adapterType: agent.adapterType,
    },
    "local agent jwt secret missing or invalid; running without injected PAPERCLIP_API_KEY",
  );
}

// 执行 adapter，传递 authToken
const adapterResult = await adapter.execute({
  runId: run.id,
  agent,
  runtime: runtimeForAdapter,
  config: resolvedConfig,
  context,
  onLog,
  onMeta: onAdapterMeta,
  authToken: authToken ?? undefined,  // 可能为 null 或 JWT
});
```

## 6. JWT Token 注入到 Agent 环境变量

**文件**: `/Users/hans.pan/paperclip/packages/adapters/claude-local/src/server/execute.ts` (第 240-242 行)

```typescript
// 在 buildClaudeRuntimeConfig() 中:

const env: Record<string, string> = { ...buildPaperclipEnv(agent) };

// ... 其他环境变量设置 ...

// 如果没有显式配置的 API Key，且有 authToken，则注入 JWT
if (!hasExplicitApiKey && authToken) {
  env.PAPERCLIP_API_KEY = authToken;
}

// 现在 env.PAPERCLIP_API_KEY = "eyJhbGc..." (JWT token)
// Agent 进程将以这个环境变量启动
```

## 7. JWT Token 验证在 Auth Middleware

**文件**: `/Users/hans.pan/paperclip/server/src/middleware/auth.ts` (第 91-122 行)

```typescript
export function actorMiddleware(
  db: Db, 
  opts: ActorMiddlewareOptions
): RequestHandler {
  return async (req, _res, next) => {
    // ... 其他认证逻辑 ...

    const token = authHeader.slice("bearer ".length).trim();
    if (!token) {
      next();
      return;
    }

    const tokenHash = hashToken(token);
    
    // 1. 首先尝试作为 API Key 查找
    const key = await db
      .select()
      .from(agentApiKeys)
      .where(and(
        eq(agentApiKeys.keyHash, tokenHash), 
        isNull(agentApiKeys.revokedAt)
      ))
      .then((rows) => rows[0] ?? null);

    if (!key) {
      // 2. 尝试作为 JWT 验证
      const claims = verifyLocalAgentJwt(token);
      if (!claims) {
        next();
        return;
      }

      // 3. 查找 agent
      const agentRecord = await db
        .select()
        .from(agents)
        .where(eq(agents.id, claims.sub))
        .then((rows) => rows[0] ?? null);

      // 4. 验证 agent 存在且属于正确公司
      if (!agentRecord || agentRecord.companyId !== claims.company_id) {
        next();
        return;
      }

      // 5. 检查 agent 状态
      if (
        agentRecord.status === "terminated" || 
        agentRecord.status === "pending_approval"
      ) {
        next();
        return;
      }

      // 6. 设置 req.actor 为已认证的 agent
      req.actor = {
        type: "agent",
        agentId: claims.sub,
        companyId: claims.company_id,
        keyId: undefined,
        runId: runIdHeader || claims.run_id || undefined,
        source: "agent_jwt",  // 标记来自 JWT 而非 API Key
      };
      next();
      return;
    }

    // 处理 API Key 认证 (省略)...
  };
}
```

## 8. JWT Claims 类型定义

**文件**: `/Users/hans.pan/paperclip/server/src/agent-auth-jwt.ts`

```typescript
export interface LocalAgentJwtClaims {
  sub: string;              // Subject: Agent ID
  company_id: string;       // Company ID
  adapter_type: string;     // Adapter type (e.g., "claude_local")
  run_id: string;           // Heartbeat run ID
  iat: number;              // Issued at (Unix timestamp, seconds)
  exp: number;              // Expiration (Unix timestamp, seconds)
  iss?: string;             // Issuer (optional)
  aud?: string;             // Audience (optional)
  jti?: string;             // JWT ID (optional)
}
```

## 9. JWT Secret 检查工具

**文件**: `/Users/hans.pan/paperclip/cli/src/checks/agent-jwt-secret-check.ts`

```typescript
export function agentJwtSecretCheck(configPath?: string): CheckResult {
  // 1. 检查环境变量
  if (readAgentJwtSecretFromEnv(configPath)) {
    return {
      name: "Agent JWT secret",
      status: "pass",
      message: "PAPERCLIP_AGENT_JWT_SECRET is set in environment",
    };
  }

  // 2. 检查 .env 文件
  const envPath = resolveAgentJwtEnvFile(configPath);
  const fileSecret = readAgentJwtSecretFromEnvFile(envPath);

  if (fileSecret) {
    return {
      name: "Agent JWT secret",
      status: "warn",
      message: `PAPERCLIP_AGENT_JWT_SECRET is present in ${envPath} but not loaded into environment`,
      repairHint: `Set the value from ${envPath} in your shell before starting the Paperclip server`,
    };
  }

  // 3. 都不存在 -> fail，提供自动修复选项
  return {
    name: "Agent JWT secret",
    status: "fail",
    message: `PAPERCLIP_AGENT_JWT_SECRET missing from environment and ${envPath}`,
    canRepair: true,
    repair: () => {
      ensureAgentJwtSecret(configPath);
    },
    repairHint: `Run with --repair to create ${envPath} containing PAPERCLIP_AGENT_JWT_SECRET`,
  };
}
```

## 总结

核心流程:
1. **Secret 管理**: `randomBytes(32).toString("hex")` 生成，存储在 `.env` 或环境变量
2. **Token 创建**: `createLocalAgentJwt()` 使用 HS256 签名
3. **Token 注入**: Heartbeat 生成 token，通过 `PAPERCLIP_API_KEY` 环境变量传给 agent
4. **Token 验证**: Auth middleware 调用 `verifyLocalAgentJwt()` 验证签名、过期时间、claims

所有验证包含:
- 签名完整性检查 (使用 timing-safe 比较防止时序攻击)
- 过期时间检查
- Issuer/Audience 检查
- Agent 存在性和状态检查
- Company 关联检查

