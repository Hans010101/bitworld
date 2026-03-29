# Paperclip Agent JWT Token 完整研究报告

## 概览

本报告总结了在 `/Users/hans.pan/paperclip` 项目中对 Agent JWT token 生成、验证和管理的完整分析。

---

## 第一部分：核心问题回答

### 1. 如何生成 Agent JWT Token?

**答案**: 由 Server 在 Heartbeat 时动态生成，不需要用户手动生成。

**具体实现**:
- **文件**: `/Users/hans.pan/paperclip/server/src/agent-auth-jwt.ts`
- **函数**: `createLocalAgentJwt(agentId, companyId, adapterType, runId)`
- **调用点**: `/Users/hans.pan/paperclip/server/src/services/heartbeat.ts` (第 1846-1868 行)

**生成步骤**:
```
1. 读取 PAPERCLIP_AGENT_JWT_SECRET (256-bit hex string)
2. 构造 JWT header: { alg: "HS256", typ: "JWT" }
3. 构造 JWT claims: { sub, company_id, adapter_type, run_id, iat, exp, iss, aud }
4. 使用 HMAC-SHA256 签名
5. 返回完整 JWT: header.payload.signature
```

**示例**:
```typescript
const token = createLocalAgentJwt(
  "agent-1",           // Agent ID
  "company-1",         // Company ID
  "claude_local",      // Adapter type
  "run-1"              // Heartbeat run ID
);
// 返回: "eyJhbGc..." (JWT token)
```

---

### 2. CLI 中是否有生成 Agent Token 的工具?

**答案**: 没有专门的命令生成 Token，但有 Secret 管理工具。

| 工具 | 功能 | 文件 | 命令 |
|------|------|------|------|
| doctor | 检查 JWT Secret | `cli/src/checks/agent-jwt-secret-check.ts` | `paperclip doctor` |
| doctor --repair | 自动生成 JWT Secret | `cli/src/config/env.ts` | `paperclip doctor --repair` |

**工作流**:
```bash
# 1. 检查配置
$ paperclip doctor
✓ Agent JWT secret is set in environment

# 2. 如果缺失，自动修复
$ paperclip doctor --repair
→ 生成 ~/.config/paperclip/.env
→ 包含 PAPERCLIP_AGENT_JWT_SECRET=<自动生成的值>
```

**为什么没有 Token 生成命令?**
- JWT 是短期 token (48h 有效期)
- 不应由用户持久化存储
- 由 server 动态生成，通过环境变量自动注入
- 每次 heartbeat 生成一个新 token

---

### 3. Server 中 JWT 签名和验证的实现代码

**签名算法**: HS256 (HMAC-SHA256)

#### 3.1 签名实现
**文件**: `/Users/hans.pan/paperclip/server/src/agent-auth-jwt.ts` (第 48-50 行)

```typescript
function signPayload(secret: string, signingInput: string) {
  return createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
}
```

#### 3.2 验证实现
**文件**: `/Users/hans.pan/paperclip/server/src/agent-auth-jwt.ts` (第 95-141 行)

验证步骤:
```
1. 解析 JWT 格式 (header.payload.signature)
2. 验证 header 算法是 HS256
3. 重新计算签名并使用 timing-safe 比较
4. 解析并验证所有 claims 的类型和值
5. 验证过期时间 (exp < now)
6. 验证 issuer 和 audience (可选)
7. 检查 agent 存在性和公司关联
8. 检查 agent 状态
```

#### 3.3 Server 侧验证实现
**文件**: `/Users/hans.pan/paperclip/server/src/middleware/auth.ts` (第 20-152 行)

```typescript
export function actorMiddleware(db: Db, opts: ActorMiddlewareOptions) {
  return async (req, _res, next) => {
    // 1. 解析 Authorization: Bearer <token>
    const token = authHeader.slice("bearer ".length).trim();
    
    // 2. 首先尝试作为 API Key 查找 (数据库)
    const key = await db.select().from(agentApiKeys)...
    
    if (!key) {
      // 3. 尝试作为 JWT 验证
      const claims = verifyLocalAgentJwt(token);
      if (!claims) return next();
      
      // 4. 验证 agent 存在且属于正确公司
      if (!agentRecord || agentRecord.companyId !== claims.company_id) 
        return next();
      
      // 5. 检查 agent 状态
      if (agentRecord.status === "terminated") 
        return next();
      
      // 6. 设置 req.actor
      req.actor = {
        type: "agent",
        agentId: claims.sub,
        companyId: claims.company_id,
        source: "agent_jwt",
      };
    }
    
    next();
  };
}
```

---

## 第二部分：技术细节

### 环境变量配置

| 变量 | 描述 | 默认值 | 生成方式 |
|------|------|--------|---------|
| `PAPERCLIP_AGENT_JWT_SECRET` | 签名密钥 (256-bit hex) | 无 (必需) | `randomBytes(32).toString("hex")` |
| `PAPERCLIP_AGENT_JWT_TTL_SECONDS` | Token 有效期 | 172800 (48h) | - |
| `PAPERCLIP_AGENT_JWT_ISSUER` | Token issuer | "paperclip" | - |
| `PAPERCLIP_AGENT_JWT_AUDIENCE` | Token audience | "paperclip-api" | - |

### JWT Token 结构

**Header**:
```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

**Claims**:
```json
{
  "sub": "agent-1",                    // Subject (Agent ID)
  "company_id": "company-1",           // Company ID
  "adapter_type": "claude_local",      // Adapter type
  "run_id": "run-1",                   // Heartbeat run ID
  "iat": 1677000000,                   // Issued at (Unix timestamp)
  "exp": 1677172800,                   // Expiration (48h later)
  "iss": "paperclip",                  // Issuer
  "aud": "paperclip-api"               // Audience
}
```

**Signature**:
```
HMAC-SHA256(base64url(header) + "." + base64url(claims), secret)
```

### 支持 JWT 的 Adapter

- claude_local
- codex_local
- cursor
- gemini_local
- opencode_local
- pi_local

---

## 第三部分：完整工作流

### 1. 初始化 (Server 启动时)

```
1. Server 启动
   ├─ 读取 PAPERCLIP_AGENT_JWT_SECRET
   ├─ 如果缺失，CLI doctor --repair 会自动创建
   └─ 验证 secret 存在 (randomBytes(32).toString("hex") = 64 字符)

2. Secret 存储位置
   ├─ 环境变量: PAPERCLIP_AGENT_JWT_SECRET=...
   └─ 文件: ~/.config/paperclip/.env (权限 0o600)
```

### 2. Heartbeat 执行时

```
1. heartbeat.ts 检查 agent 状态
   
2. 获取 adapter 配置
   └─ 检查 adapter.supportsLocalAgentJwt
   
3. 生成 JWT Token
   └─ createLocalAgentJwt(agentId, companyId, adapterType, runId)
      ├─ 读取 PAPERCLIP_AGENT_JWT_SECRET
      ├─ 创建 claims (sub, company_id, adapter_type, run_id, iat, exp...)
      ├─ 使用 HS256 签名
      └─ 返回 JWT 字符串
   
4. 传给 Adapter 执行
   └─ adapter.execute({ ..., authToken: jwt })
   
5. Adapter 注入环境变量
   └─ env.PAPERCLIP_API_KEY = jwt
   
6. Agent Process 启动
   └─ $ PAPERCLIP_API_KEY=<jwt> claude ...
```

### 3. Agent API 请求时

```
1. Agent 从环境读取 token
   └─ const token = process.env.PAPERCLIP_API_KEY
   
2. 提交 API 请求
   └─ Authorization: Bearer <jwt>
   
3. Server 接收请求
   ├─ Auth Middleware 验证
   ├─ 调用 verifyLocalAgentJwt(token)
   ├─ 验证签名、过期时间、claims
   ├─ 查询 agent 记录
   ├─ 检查 agent 状态和公司关联
   └─ 设置 req.actor (type: "agent", ...)
   
4. 路由处理请求
   └─ 使用 req.actor.agentId 和 req.actor.companyId
```

### 4. Token 生命周期

```
生成时刻:
  └─ Heartbeat 执行时

有效期:
  └─ iat: 现在时间
  └─ exp: 现在时间 + 48 小时

过期处理:
  └─ 自动过期，无需主动撤销
  └─ 下一个 heartbeat 生成新 token

自动注入:
  └─ Server → Adapter → Agent Process
  └─ 无需用户管理
```

---

## 第四部分：安全特性

### 1. 签名安全

- **算法**: HS256 (对称密钥)
- **密钥强度**: 256-bit (64 字符十六进制)
- **生成方式**: `randomBytes(32)` - 密码学安全随机数

### 2. 时序攻击防护

```typescript
function safeCompare(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);  // 防止时序攻击
}
```

### 3. Token 有效期

- **默认**: 48 小时
- **考虑**: 足够长给 agent 完成工作，足够短减少泄露风险
- **机制**: 每个 heartbeat 生成新 token，不会无限续期

### 4. Chain of Trust 检查

验证包括:
```
签名完整性 → 过期时间 → Issuer/Audience → Agent 存在性 → Company 关联 → Agent 状态
```

### 5. 与 API Key 区别

| 特性 | JWT | API Key |
|------|-----|---------|
| 生命周期 | 短期 (48h) | 长期 |
| 存储 | 不存储 (无状态) | 哈希存储数据库 |
| 生成方式 | Server 自动 | 用户创建 |
| 验证方式 | 签名验证 | 数据库查询 |
| 适用场景 | 本地 adapter | 远程 agent |

---

## 第五部分：关键文件列表

### Server 侧 (核心实现)

| 文件 | 行数 | 功能 |
|------|------|------|
| `server/src/agent-auth-jwt.ts` | 142 | JWT 创建和验证 |
| `server/src/services/heartbeat.ts` | 1846-1868 | Token 生成入口 |
| `server/src/middleware/auth.ts` | 91-122 | Token 验证 middleware |
| `server/src/__tests__/agent-auth-jwt.test.ts` | - | JWT 单元测试 |

### CLI 侧 (Secret 管理)

| 文件 | 行数 | 功能 |
|------|------|------|
| `cli/src/config/env.ts` | 77-93 | Secret 生成和读取 |
| `cli/src/checks/agent-jwt-secret-check.ts` | 40 | Secret 校验工具 |
| `cli/src/__tests__/agent-jwt-env.test.ts` | - | Secret 管理测试 |

### Adapter 实现

| 文件 | 行数 | 功能 |
|------|------|------|
| `packages/adapters/claude-local/src/server/execute.ts` | 240-242 | Token 注入环境变量 |
| `packages/adapters/codex-local/src/server/execute.ts` | - | 相同实现 |
| (其他 adapter) | - | 相同实现 |

### 设计文档

| 文件 | 功能 |
|------|------|
| `doc/plans/2026-02-18-agent-authentication.md` | 认证架构和设计原则 |

---

## 第六部分：使用指南

### 开发者

#### 生成测试 Token
```typescript
import { createLocalAgentJwt, verifyLocalAgentJwt } from '@paperclipai/server';

process.env.PAPERCLIP_AGENT_JWT_SECRET = 'test-secret';
const token = createLocalAgentJwt('agent-1', 'company-1', 'claude_local', 'run-1');
const claims = verifyLocalAgentJwt(token);
console.log(claims);
```

#### 运行测试
```bash
cd /Users/hans.pan/paperclip/server
npm test -- agent-auth-jwt.test.ts
```

### 运维人员

#### 初始化 JWT Secret
```bash
# 自动生成 secret 到 ~/.config/paperclip/.env
paperclip doctor --repair
```

#### 验证配置
```bash
# 检查 JWT secret 是否正确配置
paperclip doctor
```

#### 手动设置 Secret
```bash
export PAPERCLIP_AGENT_JWT_SECRET=$(openssl rand -hex 32)
paperclip run
```

---

## 第七部分：常见问题

### Q: JWT Token 会过期吗?
**A**: 是的，默认 48 小时后过期。需要新的 heartbeat 生成新 token。

### Q: Token 能手动撤销吗?
**A**: 不需要。Token 的安全性依赖于签名 secret，撤销 secret 会导致所有现有 token 失效。

### Q: 能改变 Token 有效期吗?
**A**: 是的，设置 `PAPERCLIP_AGENT_JWT_TTL_SECONDS` 环境变量。

### Q: 如果 Secret 泄露怎么办?
**A**: 1. 生成新 secret: `openssl rand -hex 32`
     2. 更新 `PAPERCLIP_AGENT_JWT_SECRET`
     3. 重启 Server (所有现有 token 失效)

### Q: 能用同一个 Token 访问多个 Company 吗?
**A**: 不能。Token 中的 `company_id` 绑定了特定公司，跨公司访问会被拒绝。

---

## 第八部分：性能考虑

### Token 生成成本

- **时间复杂度**: O(1)
- **空间复杂度**: O(1)
- **HMAC-SHA256**: ~1ms (现代 CPU)
- **频率**: 每个 heartbeat 一次 (通常每分钟或更少)

### 验证成本

- **时间复杂度**: O(n) - n = JWT 长度 (约 500 字节)
- **主要开销**: 重新计算签名和 timing-safe 比较
- **频率**: 每个 API 请求一次

### 可扩展性

- **无状态验证**: 不需要数据库查询签名
- **无 Token 撤销列表**: 无需维护黑名单
- **水平扩展**: 任何 server 实例都能验证 token

---

## 结论

Paperclip 使用 **HS256 JWT** 为本地 adapter agent 提供短期认证:

1. **Server 自动生成**: Heartbeat 时动态创建，无需用户干预
2. **临时凭证**: 48 小时有效期，自动过期
3. **安全设计**: HMAC-SHA256 签名、timing-safe 比较、chain of trust 检查
4. **无状态验证**: 仅需 JWT secret，无需数据库
5. **与 API Key 互补**: JWT 用于短期本地认证，API Key 用于长期远程认证

所有实现遵循 JWT 标准 (RFC 7519) 和安全最佳实践。

