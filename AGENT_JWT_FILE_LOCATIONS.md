# Paperclip Agent JWT Token 文件位置地图

```
/Users/hans.pan/paperclip/
├── server/
│   ├── src/
│   │   ├── agent-auth-jwt.ts                    ★★★ JWT 核心实现 (创建/验证)
│   │   ├── services/
│   │   │   └── heartbeat.ts                     ★★★ JWT 生成入口点 (第1846-1868行)
│   │   ├── middleware/
│   │   │   └── auth.ts                          ★★★ JWT 验证 middleware (第91-120行)
│   │   └── __tests__/
│   │       └── agent-auth-jwt.test.ts           ★★ JWT 测试用例
│   │
│   └── 其他 adapter 也使用 JWT:
│       ├── packages/adapters/claude-local/src/server/execute.ts
│       ├── packages/adapters/codex-local/src/server/execute.ts
│       ├── packages/adapters/cursor-local/src/server/execute.ts
│       └── ...
│
├── cli/
│   ├── src/
│   │   ├── config/
│   │   │   └── env.ts                           ★★★ JWT Secret 管理 (生成/读取)
│   │   ├── checks/
│   │   │   └── agent-jwt-secret-check.ts        ★★ JWT Secret 校验工具
│   │   └── __tests__/
│   │       └── agent-jwt-env.test.ts            ★★ JWT Secret 管理测试
│   │
│   └── 运行 CLI doctor 命令会执行 agent-jwt-secret-check
│
├── doc/plans/
│   └── 2026-02-18-agent-authentication.md       ★ 设计文档 (概念和架构)
│
└── scripts/
    └── (暂无自动生成 JWT token 的脚本，JWT 由 server 在 heartbeat 时动态生成)
```

## 核心文件说明

### 1. 文件: `/Users/hans.pan/paperclip/server/src/agent-auth-jwt.ts`
   - **行数**: 142 行
   - **功能**:
     - `createLocalAgentJwt()` - 生成 JWT (行 68-93)
     - `verifyLocalAgentJwt()` - 验证 JWT (行 95-141)
     - `jwtConfig()` - 读取 JWT 配置 (行 28-38)
     - `signPayload()` - HS256 签名 (行 48-50)
     - `safeCompare()` - Timing-safe 比较 (行 61-66)

### 2. 文件: `/Users/hans.pan/paperclip/server/src/services/heartbeat.ts`
   - **行数**: 2000+
   - **关键行**: 1846-1868
   - **功能**: 
     - 导入 `createLocalAgentJwt()`
     - 为每个 heartbeat run 生成 JWT token
     - 通过 `authToken` 参数传给 adapter

### 3. 文件: `/Users/hans.pan/paperclip/server/src/middleware/auth.ts`
   - **行数**: 157
   - **关键行**: 91-120 (JWT 验证逻辑)
   - **功能**:
     - 解析 Authorization header
     - 调用 `verifyLocalAgentJwt()` 验证 token
     - 从 JWT claims 提取 agent 信息
     - 检查 agent 状态和公司关联
     - 设置 `req.actor` 供下游路由使用

### 4. 文件: `/Users/hans.pan/paperclip/cli/src/config/env.ts`
   - **行数**: 126
   - **关键行**: 7, 62-75, 77-93, 95-97
   - **功能**:
     - `ensureAgentJwtSecret()` - 自动生成或读取 secret (行 77-93)
     - `readAgentJwtSecretFromEnv()` - 从环境读取 (行 62-66)
     - `readAgentJwtSecretFromEnvFile()` - 从 .env 文件读取 (行 68-75)
     - Secret 生成: `randomBytes(32).toString("hex")` - 256-bit 随机值

### 5. 文件: `/Users/hans.pan/paperclip/cli/src/checks/agent-jwt-secret-check.ts`
   - **行数**: 41
   - **功能**: 
     - CLI doctor 命令用来检查 JWT secret 是否存在
     - 提供修复建议和自动修复功能

### 6. 文件: `/Users/hans.pan/paperclip/packages/adapters/claude-local/src/server/execute.ts`
   - **行数**: 500+
   - **关键行**: 240-242
   - **功能**:
     - 接收 `authToken` 参数
     - 注入到环境变量 `PAPERCLIP_API_KEY`
     - 其他 adapter (codex-local, cursor, 等) 的实现类似

## 环境变量流向

```
生成 Secret:
  CLI → randomBytes(32).toString("hex") → .env 文件或环境变量

使用 Secret:
  process.env.PAPERCLIP_AGENT_JWT_SECRET 
    → agent-auth-jwt.ts:jwtConfig()
      → createLocalAgentJwt() 生成 token
      → heartbeat.ts 传给 adapter
      → adapter 注入环境变量 PAPERCLIP_API_KEY
      → agent process 使用

验证 Secret:
  Authorization: Bearer <token>
    → auth.ts middleware
      → verifyLocalAgentJwt()
        → agent-auth-jwt.ts 验证签名
        → 检查 claims 和过期时间
```

## 测试文件

### 1. `/Users/hans.pan/paperclip/server/src/__tests__/agent-auth-jwt.test.ts`
   - 测试 JWT 创建和验证
   - 测试过期检查
   - 测试 issuer/audience 验证

### 2. `/Users/hans.pan/paperclip/cli/src/__tests__/agent-jwt-env.test.ts`
   - 测试 secret 文件生成
   - 测试 secret 文件读取
   - 测试 doctor 检查命令

## 工作流程图

```
┌─────────────────────────────────────────────────────────────┐
│                    Heartbeat Service                         │
│  (server/src/services/heartbeat.ts)                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ├─→ 检查 adapter 是否支持本地 JWT
                           │   (adapter.supportsLocalAgentJwt)
                           │
                           ├─→ 读取 PAPERCLIP_AGENT_JWT_SECRET
                           │
                           ├─→ 调用 createLocalAgentJwt()
                           │   (生成新 token)
                           │
                           └─→ 传递 authToken 给 adapter.execute()
                               │
                               └─→ adapter 注入环境变量
                                   (env.PAPERCLIP_API_KEY = token)
                                   │
                                   └─→ Agent Process 启动
                                       │
                                       └─→ Agent 读取环境变量
                                           │
                                           └─→ API 请求带上 token
                                               Authorization: Bearer <token>
                                               │
                                               └─→ Server Auth Middleware
                                                   (server/src/middleware/auth.ts)
                                                   │
                                                   ├─→ 解析 Authorization header
                                                   │
                                                   ├─→ 调用 verifyLocalAgentJwt()
                                                   │
                                                   ├─→ 验证签名
                                                   │
                                                   ├─→ 验证过期时间
                                                   │
                                                   ├─→ 验证 issuer/audience
                                                   │
                                                   └─→ 设置 req.actor
                                                       (type: "agent", ...)
```

## 快速定位指南

**问题**: 如何生成 Agent JWT token?
- 查看: `/Users/hans.pan/paperclip/server/src/agent-auth-jwt.ts` 的 `createLocalAgentJwt()`

**问题**: JWT secret 在哪里?
- 查看: `/Users/hans.pan/paperclip/cli/src/config/env.ts` 的 `ensureAgentJwtSecret()`
- 文件位置: `~/.config/paperclip/.env` (或配置目录旁边的 .env)

**问题**: Server 怎样验证 JWT?
- 查看: `/Users/hans.pan/paperclip/server/src/agent-auth-jwt.ts` 的 `verifyLocalAgentJwt()`
- 与: `/Users/hans.pan/paperclip/server/src/middleware/auth.ts` 的 middleware 实现

**问题**: 怎样测试 JWT?
- 查看: `/Users/hans.pan/paperclip/server/src/__tests__/agent-auth-jwt.test.ts`

**问题**: 有没有 CLI 工具生成 token?
- 没有专门的 CLI 命令生成 token（JWT 由 server 动态生成）
- 有 CLI 检查工具: `/Users/hans.pan/paperclip/cli/src/checks/agent-jwt-secret-check.ts`
- 使用命令: `paperclip doctor --repair` 会自动创建 JWT secret

