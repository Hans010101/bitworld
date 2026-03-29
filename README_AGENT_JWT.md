# Paperclip Agent JWT Token 研究报告 - 文档索引

本索引总结了对 Paperclip 项目中 Agent JWT Token 实现的完整研究。

## 快速导航

### 对您最有用的文档

**如果您想...**
- **理解整体架构** → 先看 [AGENT_JWT_RESEARCH.md](./AGENT_JWT_RESEARCH.md) (12 KB)
- **快速找到关键代码** → 看 [AGENT_JWT_CODE_SNIPPETS.md](./AGENT_JWT_CODE_SNIPPETS.md) (14 KB)
- **知道代码在哪里** → 查 [AGENT_JWT_FILE_LOCATIONS.md](./AGENT_JWT_FILE_LOCATIONS.md) (8 KB)
- **了解 CLI 工具** → 读 [AGENT_JWT_CLI_TOOLS.md](./AGENT_JWT_CLI_TOOLS.md) (7 KB)
- **深入技术细节** → 进入 [AGENT_JWT_IMPLEMENTATION.md](./AGENT_JWT_IMPLEMENTATION.md) (13 KB)

## 核心问题速答

### 1. 如何生成 Agent JWT Token?

由 Server 在 Heartbeat 时动态生成。

**关键文件**:
- `/Users/hans.pan/bitworld/server/src/agent-auth-jwt.ts` - `createLocalAgentJwt()`
- `/Users/hans.pan/bitworld/server/src/services/heartbeat.ts` - 第 1846-1868 行

**示例**:
```typescript
const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
// 返回: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJz..." (JWT token)
```

### 2. CLI 中有生成 Token 的工具吗?

没有专门的 CLI 命令生成 Token，但有 Secret 管理工具。

**可用工具**:
```bash
paperclip doctor              # 检查 JWT Secret
paperclip doctor --repair     # 自动生成 JWT Secret
```

**为什么**:
- JWT 是短期 token (48 小时有效期)
- 由 server 动态生成，每个 heartbeat 一个新 token
- 不需要用户持久化存储

**详见**: [AGENT_JWT_CLI_TOOLS.md](./AGENT_JWT_CLI_TOOLS.md)

### 3. JWT 签名和验证如何实现?

使用 **HS256** (HMAC-SHA256)。

**签名流程**:
```
secret + header + payload → HMAC-SHA256 → signature
```

**验证流程**:
```
1. 重新计算签名
2. Timing-safe 比较
3. 验证过期时间
4. 验证 claims
5. 检查 agent 存在性和公司关联
```

**关键文件**:
- `/Users/hans.pan/bitworld/server/src/agent-auth-jwt.ts` - 核心实现
- `/Users/hans.pan/bitworld/server/src/middleware/auth.ts` - Middleware 验证

**详见**: [AGENT_JWT_CODE_SNIPPETS.md](./AGENT_JWT_CODE_SNIPPETS.md)

## 文档详细说明

### AGENT_JWT_RESEARCH.md (主报告)
**大小**: 12 KB  
**内容**:
- 核心问题的完整答案
- 技术细节 (JWT 结构、claims、signature)
- 完整工作流 (初始化 → 生成 → 验证)
- 安全特性分析
- 文件清单
- 使用指南
- 常见问题
- 性能考虑

**适合**: 想要全面了解的人

### AGENT_JWT_CODE_SNIPPETS.md (代码参考)
**大小**: 14 KB  
**内容**:
- JWT 创建核心代码
- JWT 验证核心代码
- Secret 管理代码
- Heartbeat 集成代码
- Adapter 集成代码
- Auth Middleware 代码
- Claims 类型定义
- Secret 检查工具代码

**适合**: 需要看具体实现的开发者

### AGENT_JWT_FILE_LOCATIONS.md (导航地图)
**大小**: 8 KB  
**内容**:
- 项目文件结构
- 核心文件说明 (行数、功能)
- 环境变量流向
- 测试文件
- 工作流程图
- 快速定位指南

**适合**: 想快速找到相关代码的人

### AGENT_JWT_CLI_TOOLS.md (工具指南)
**大小**: 7 KB  
**内容**:
- CLI 工具清单
- doctor 命令详解
- Secret 管理流程
- 与 API Key 的区别
- 测试方法
- 常见操作

**适合**: 运维人员和 DevOps

### AGENT_JWT_IMPLEMENTATION.md (深度分析)
**大小**: 13 KB  
**内容**:
- 完整的 JWT 签名和验证算法
- 环境变量配置详解
- Secret 生成和管理
- Token 传递机制
- Server 侧验证流程
- 测试用例分析
- 支持的 Adapter 列表
- Token 生命周期

**适合**: 需要深入理解的人

## 技术概览

### JWT Token 结构

```
header.payload.signature

header: {"alg":"HS256","typ":"JWT"}
payload: {"sub":"agent-1","company_id":"company-1",...,"exp":...}
signature: HMAC-SHA256(header.payload, secret)
```

### 关键数据流

```
Server Startup
  ↓
readAgentJwtSecret (PAPERCLIP_AGENT_JWT_SECRET)
  ↓
Heartbeat Trigger
  ↓
createLocalAgentJwt() → JWT token
  ↓
adapter.execute({ authToken: jwt })
  ↓
Agent Process: env.PAPERCLIP_API_KEY = jwt
  ↓
Agent API Request: Authorization: Bearer <jwt>
  ↓
Server: verifyLocalAgentJwt(token)
  ↓
set req.actor.agentId, req.actor.companyId
```

### 关键文件映射

| 功能 | 文件 | 行数 |
|------|------|------|
| JWT 创建和验证 | `server/src/agent-auth-jwt.ts` | 142 |
| Token 生成入口 | `server/src/services/heartbeat.ts` | 1846-1868 |
| Token 验证 | `server/src/middleware/auth.ts` | 91-122 |
| Secret 管理 | `cli/src/config/env.ts` | 77-93 |
| Secret 检查 | `cli/src/checks/agent-jwt-secret-check.ts` | 40 |
| Token 注入 | `packages/adapters/claude-local/src/server/execute.ts` | 240-242 |

## 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `PAPERCLIP_AGENT_JWT_SECRET` | 签名密钥 (256-bit hex) | 无 (必需) |
| `PAPERCLIP_AGENT_JWT_TTL_SECONDS` | Token 有效期 | 172800 (48h) |
| `PAPERCLIP_AGENT_JWT_ISSUER` | Issuer | "paperclip" |
| `PAPERCLIP_AGENT_JWT_AUDIENCE` | Audience | "paperclip-api" |

## 支持的 Adapter

- claude_local
- codex_local
- cursor
- gemini_local
- opencode_local
- pi_local

## 快速命令参考

```bash
# 检查 JWT Secret 配置
paperclip doctor

# 自动生成 JWT Secret
paperclip doctor --repair

# 手动设置 Secret
export PAPERCLIP_AGENT_JWT_SECRET=$(openssl rand -hex 32)

# 运行 JWT 测试
cd /Users/hans.pan/bitworld/server
npm test -- agent-auth-jwt.test.ts

# 查看 JWT Secret 文件
cat ~/.config/paperclip/.env
```

## 关键概念

### HS256 (HMAC-SHA256)
- 对称加密算法
- Secret 需要在 server 和 agent 之间共享
- 签名 = HMAC-SHA256(header.payload, secret)

### Timing-Safe Comparison
- 防止时序攻击
- 使用 `timingSafeEqual()` 比较签名
- 在代码第 61-66 行实现

### Claims (负载)
- `sub`: Agent ID
- `company_id`: Company ID
- `adapter_type`: Adapter 类型
- `run_id`: Heartbeat run ID
- `iat`: 签发时间
- `exp`: 过期时间
- `iss`: 签发者 (可选)
- `aud`: 预期接收者 (可选)

### Chain of Trust
验证流程: 签名 → 过期时间 → Issuer/Audience → Agent 存在 → Company 关联 → Agent 状态

## 常见问题

**Q: JWT Token 有多长时间有效?**
A: 默认 48 小时。可通过 `PAPERCLIP_AGENT_JWT_TTL_SECONDS` 自定义。

**Q: 如果 Secret 泄露怎么办?**
A: 生成新 secret，重启 server。所有现有 token 立即失效。

**Q: Token 能被撤销吗?**
A: 不需要。Token 无状态验证，由 secret 保护。改变 secret 即可使所有 token 失效。

**Q: 能用同一个 Token 访问多个公司?**
A: 不能。Token 中的 `company_id` 是固定的，会被验证。

**Q: 怎样测试 JWT Token?**
A: 
```typescript
import { createLocalAgentJwt, verifyLocalAgentJwt } from './src/agent-auth-jwt.js';
process.env.PAPERCLIP_AGENT_JWT_SECRET = 'test-secret';
const token = createLocalAgentJwt('agent-1', 'company-1', 'claude_local', 'run-1');
const claims = verifyLocalAgentJwt(token);
```

## 参考资源

- **设计文档**: `/Users/hans.pan/bitworld/doc/plans/2026-02-18-agent-authentication.md`
- **测试用例**: `/Users/hans.pan/bitworld/server/src/__tests__/agent-auth-jwt.test.ts`
- **JWT 标准**: RFC 7519

## 总结

Paperclip 使用 **HS256 JWT** 为本地 adapter agent 提供短期认证:
- Server 自动生成，无需用户干预
- 48 小时有效期，自动过期
- HMAC-SHA256 签名，timing-safe 比较
- 无状态验证，无需数据库
- 与 API Key 互补

---

**最后更新**: 2026-03-18  
**研究范围**: `/Users/hans.pan/bitworld` (整个项目)  
**文档格式**: Markdown  
**所有文件**: 5 个 Markdown 文档 + 本索引

