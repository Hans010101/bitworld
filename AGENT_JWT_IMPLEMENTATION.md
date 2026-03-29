# Paperclip Agent JWT Token 完整分析

## 1. JWT Token 生成流程

### 1.1 入口点：Heartbeat Service
**文件**: `/Users/hans.pan/bitworld/server/src/services/heartbeat.ts` (第 1846-1868 行)

```typescript
const adapter = getServerAdapter(agent.adapterType);
const authToken = adapter.supportsLocalAgentJwt
  ? createLocalAgentJwt(agent.id, agent.companyId, agent.adapterType, run.id)
  : null;
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
const adapterResult = await adapter.execute({
  // ... other params
  authToken: authToken ?? undefined,
});
```

### 1.2 JWT 创建和验证核心实现
**文件**: `/Users/hans.pan/bitworld/server/src/agent-auth-jwt.ts`

#### 创建 JWT (行 68-93)
```typescript
export function createLocalAgentJwt(agentId: string, companyId: string, adapterType: string, runId: string) {
  const config = jwtConfig();
  if (!config) return null;

  const now = Math.floor(Date.now() / 1000);
  const claims: LocalAgentJwtClaims = {
    sub: agentId,                           // Subject: agent ID
    company_id: companyId,                  // Company ID
    adapter_type: adapterType,              // Adapter type (e.g., claude_local)
    run_id: runId,                          // Heartbeat run ID
    iat: now,                               // Issued at time
    exp: now + config.ttlSeconds,           // Expiration time (default 48h)
    iss: config.issuer,                     // Issuer (default: "paperclip")
    aud: config.audience,                   // Audience (default: "paperclip-api")
  };

  const header = {
    alg: JWT_ALGORITHM,                     // "HS256"
    typ: "JWT",
  };

  // JWT format: header.payload.signature
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const signature = signPayload(config.secret, signingInput);

  return `${signingInput}.${signature}`;
}
```

#### 验证 JWT (行 95-141)
```typescript
export function verifyLocalAgentJwt(token: string): LocalAgentJwtClaims | null {
  if (!token) return null;
  const config = jwtConfig();
  if (!config) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, claimsB64, signature] = parts;

  // 1. 验证 header 算法
  const header = parseJson(base64UrlDecode(headerB64));
  if (!header || header.alg !== JWT_ALGORITHM) return null;

  // 2. 验证签名 (使用 timing-safe 比较防止时序攻击)
  const signingInput = `${headerB64}.${claimsB64}`;
  const expectedSig = signPayload(config.secret, signingInput);
  if (!safeCompare(signature, expectedSig)) return null;

  // 3. 解析和验证 claims
  const claims = parseJson(base64UrlDecode(claimsB64));
  if (!claims) return null;

  // 必要字段验证
  const sub = typeof claims.sub === "string" ? claims.sub : null;
  const companyId = typeof claims.company_id === "string" ? claims.company_id : null;
  const adapterType = typeof claims.adapter_type === "string" ? claims.adapter_type : null;
  const runId = typeof claims.run_id === "string" ? claims.run_id : null;
  const iat = typeof claims.iat === "number" ? claims.iat : null;
  const exp = typeof claims.exp === "number" ? claims.exp : null;
  if (!sub || !companyId || !adapterType || !runId || !iat || !exp) return null;

  // 4. 验证过期时间
  const now = Math.floor(Date.now() / 1000);
  if (exp < now) return null;

  // 5. 验证 issuer 和 audience (可选但推荐)
  const issuer = typeof claims.iss === "string" ? claims.iss : undefined;
  const audience = typeof claims.aud === "string" ? claims.aud : undefined;
  if (issuer && issuer !== config.issuer) return null;
  if (audience && audience !== config.audience) return null;

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
```

## 2. JWT 配置和签名实现细节

### 2.1 JWT 配置来源 (行 28-38)
```typescript
function jwtConfig() {
  const secret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  if (!secret) return null;

  return {
    secret,
    ttlSeconds: parseNumber(process.env.PAPERCLIP_AGENT_JWT_TTL_SECONDS, 60 * 60 * 48),  // 默认 48 小时
    issuer: process.env.PAPERCLIP_AGENT_JWT_ISSUER ?? "paperclip",
    audience: process.env.PAPERCLIP_AGENT_JWT_AUDIENCE ?? "paperclip-api",
  };
}
```

### 2.2 签名实现 (行 48-50)
```typescript
function signPayload(secret: string, signingInput: string) {
  return createHmac("sha256", secret).update(signingInput).digest("base64url");
}
```

### 2.3 安全的签名比较 (行 61-66)
```typescript
function safeCompare(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);  // 防止时序攻击
}
```

## 3. JWT Secret 管理

### 3.1 Secret 生成和读取
**文件**: `/Users/hans.pan/bitworld/cli/src/config/env.ts`

```typescript
// 行 7: JWT Secret 环境变量名称
const JWT_SECRET_ENV_KEY = "PAPERCLIP_AGENT_JWT_SECRET";

// 行 77-93: 确保 JWT Secret 存在 (自动生成或读取现有)
export function ensureAgentJwtSecret(configPath?: string): { secret: string; created: boolean } {
  const existingEnv = readAgentJwtSecretFromEnv(configPath);
  if (existingEnv) {
    return { secret: existingEnv, created: false };
  }

  const envFilePath = resolveEnvFilePath(configPath);
  const existingFile = readAgentJwtSecretFromEnvFile(envFilePath);
  const secret = existingFile ?? randomBytes(32).toString("hex");  // 生成 256-bit 随机 secret
  const created = !existingFile;

  if (!existingFile) {
    writeAgentJwtEnv(secret, envFilePath);
  }

  return { secret, created };
}

// 行 62-66: 从环境或 .env 文件读取 secret
export function readAgentJwtSecretFromEnv(configPath?: string): string | null {
  loadAgentJwtEnvFile(resolveEnvFilePath(configPath));
  const raw = process.env[JWT_SECRET_ENV_KEY];
  return isNonEmpty(raw) ? raw!.trim() : null;
}

// 行 68-75: 从文件读取 secret
export function readAgentJwtSecretFromEnvFile(filePath = resolveEnvFilePath()): string | null {
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const values = parseEnvFile(raw);
  const value = values[JWT_SECRET_ENV_KEY];
  return isNonEmpty(value) ? value!.trim() : null;
}
```

### 3.2 CLI 检查工具
**文件**: `/Users/hans.pan/bitworld/cli/src/checks/agent-jwt-secret-check.ts`

```typescript
export function agentJwtSecretCheck(configPath?: string): CheckResult {
  if (readAgentJwtSecretFromEnv(configPath)) {
    return {
      name: "Agent JWT secret",
      status: "pass",
      message: "PAPERCLIP_AGENT_JWT_SECRET is set in environment",
    };
  }

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

## 4. JWT Token 如何传递给 Agent

### 4.1 注入到环境变量 (Adapter 侧)
**文件**: `/Users/hans.pan/bitworld/packages/adapters/claude-local/src/server/execute.ts` (行 240-242)

```typescript
if (!hasExplicitApiKey && authToken) {
  env.PAPERCLIP_API_KEY = authToken;
}
```

Agent 在运行时通过环境变量 `PAPERCLIP_API_KEY` 获得 JWT token。

## 5. Server 侧 JWT 验证

### 5.1 Auth Middleware
**文件**: `/Users/hans.pan/bitworld/server/src/middleware/auth.ts` (行 20-152)

```typescript
export function actorMiddleware(db: Db, opts: ActorMiddlewareOptions): RequestHandler {
  return async (req, _res, next) => {
    // ... 省略其他认证逻辑 ...

    const token = authHeader.slice("bearer ".length).trim();
    if (!token) {
      next();
      return;
    }

    const tokenHash = hashToken(token);
    // 1. 首先尝试查找 API Key
    const key = await db
      .select()
      .from(agentApiKeys)
      .where(and(eq(agentApiKeys.keyHash, tokenHash), isNull(agentApiKeys.revokedAt)))
      .then((rows) => rows[0] ?? null);

    if (!key) {
      // 2. 如果不是 API Key，尝试验证为 JWT
      const claims = verifyLocalAgentJwt(token);
      if (!claims) {
        next();
        return;
      }

      const agentRecord = await db
        .select()
        .from(agents)
        .where(eq(agents.id, claims.sub))
        .then((rows) => rows[0] ?? null);

      // 3. 验证 agent 存在且属于正确公司
      if (!agentRecord || agentRecord.companyId !== claims.company_id) {
        next();
        return;
      }

      // 4. 检查 agent 状态
      if (agentRecord.status === "terminated" || agentRecord.status === "pending_approval") {
        next();
        return;
      }

      // 5. 设置 req.actor
      req.actor = {
        type: "agent",
        agentId: claims.sub,
        companyId: claims.company_id,
        keyId: undefined,
        runId: runIdHeader || claims.run_id || undefined,
        source: "agent_jwt",
      };
      next();
      return;
    }

    // ... 处理 API Key 的逻辑 ...
  };
}
```

## 6. 测试用例

### 6.1 JWT 创建和验证测试
**文件**: `/Users/hans.pan/bitworld/server/src/__tests__/agent-auth-jwt.test.ts`

关键测试场景：
- 创建和验证有效的 JWT token
- Secret 缺失时返回 null
- 验证过期 token 被拒绝
- 验证 issuer/audience 不匹配被拒绝

### 6.2 CLI Secret 管理测试
**文件**: `/Users/hans.pan/bitworld/cli/src/__tests__/agent-jwt-env.test.ts`

关键测试场景：
- 在指定配置路径旁边生成 .env 文件
- 从 .env 文件加载 secret
- doctor 检查能正确验证 secret
- 处理包含特殊字符的环境变量

## 7. 支持的 Adapter 列表

支持本地 JWT 的 adapter：
- claude_local
- codex_local  
- cursor
- gemini_local
- opencode_local
- pi_local

**相关文件**: `/Users/hans.pan/bitworld/server/src/services/heartbeat.ts` (行 52-59)

## 8. JWT Token Claims 结构

```typescript
interface LocalAgentJwtClaims {
  sub: string;              // Subject (Agent ID)
  company_id: string;       // Company ID
  adapter_type: string;     // Adapter type
  run_id: string;           // Heartbeat run ID
  iat: number;              // Issued at (Unix timestamp)
  exp: number;              // Expiration (Unix timestamp)
  iss?: string;             // Issuer (optional)
  aud?: string;             // Audience (optional)
  jti?: string;             // JWT ID (optional)
}
```

## 9. 环境变量配置

| 环境变量 | 描述 | 默认值 |
|--------|------|--------|
| `PAPERCLIP_AGENT_JWT_SECRET` | JWT 签名密钥 (256-bit hex) | 无 (必需) |
| `PAPERCLIP_AGENT_JWT_TTL_SECONDS` | Token 有效期 | 172800 (48h) |
| `PAPERCLIP_AGENT_JWT_ISSUER` | Token issuer | "paperclip" |
| `PAPERCLIP_AGENT_JWT_AUDIENCE` | Token audience | "paperclip-api" |

## 10. JWT Token 生命周期

1. **Heartbeat 启动**: Server 调用 `createLocalAgentJwt()`
2. **Token 签名**: 使用 HS256 + HMAC-SHA256 签名
3. **Token 注入**: 通过 `PAPERCLIP_API_KEY` 环境变量传给 agent process
4. **Token 使用**: Agent 在 API 请求中使用 `Authorization: Bearer <token>`
5. **Token 验证**: Server 使用 `verifyLocalAgentJwt()` 验证
6. **过期处理**: Token 过期后自动被拒绝，需要新的 heartbeat 生成新 token

## 11. 安全特性

- **HMAC-SHA256**: 使用对称加密算法进行签名
- **Timing-safe 比较**: 防止时序攻击
- **短期有效**: 默认 48 小时有效期
- **完整性检查**: 验证 header、claims 和签名
- **过期检查**: 严格验证 exp claim
- **Chain of trust**: 验证 agent 存在、公司关联和状态
- **256-bit secret**: 足够强的密钥强度

---

**总结**: Paperclip 使用 HS256 JWT 进行本地 agent 认证，由 server 每次 heartbeat 生成新 token，
通过环境变量注入给 agent，agent 在 API 请求时通过 Bearer 令牌提交，server 使用 JWT secret 验证签名。
所有验证都包含过期时间、issuer/audience 和 chain of trust 检查。
