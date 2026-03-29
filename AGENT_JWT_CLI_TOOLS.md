# Paperclip Agent JWT Token - CLI 工具总结

## 1. 是否有 CLI 脚本直接生成 Agent Token?

**答案**: 没有专门的 CLI 命令生成 Agent JWT token

### 原因:
- Agent JWT token 是**动态短期 token**，不应由用户手动生成
- 每个 heartbeat 都会生成一个新的 token，有效期仅 48 小时
- Token 直接由 server 在 heartbeat 时刻创建，通过环境变量注入给 agent process

## 2. 有哪些 CLI 工具与 JWT 相关?

### 2.1 `paperclip doctor` - 系统诊断工具

**功能**: 检查 JWT Secret 是否配置正确
**文件**: `/Users/hans.pan/paperclip/cli/src/checks/agent-jwt-secret-check.ts`
**命令**: 
```bash
paperclip doctor                # 检查系统配置
paperclip doctor --repair       # 自动修复缺失的 JWT Secret
```

**行为**:
```typescript
// 检查流程:
1. 检查 process.env.PAPERCLIP_AGENT_JWT_SECRET
2. 检查 ~/.config/paperclip/.env 中的 SECRET
3. 如果都不存在，标记为 fail 并提供 --repair 选项
4. --repair 会调用 ensureAgentJwtSecret() 自动生成

// 示例输出:
✓ Agent JWT secret is set in environment
✓ PAPERCLIP_AGENT_JWT_SECRET is present in /Users/hans/.config/paperclip/.env but not loaded

修复步骤:
1. doctor 命令发现缺失 JWT Secret
2. 用户运行: paperclip doctor --repair
3. 自动在 ~/.config/paperclip/.env 生成 32 字节随机值
4. 文件权限设置为 0o600 (仅所有者可读写)
```

### 2.2 JWT Secret 文件位置

**环境变量**: `PAPERCLIP_AGENT_JWT_SECRET`
**文件位置**: `~/.config/paperclip/.env` (或 `$PAPERCLIP_CONFIG_DIR/.env`)
**文件权限**: 0o600 (仅所有者可读写，防止泄露)
**格式**: 256-bit 十六进制字符串 (64 字符)
**生成方式**: `randomBytes(32).toString("hex")`

## 3. 没有生成 Token 的 CLI 脚本的原因

### 3.1 设计原则
从 `/Users/hans.pan/paperclip/doc/plans/2026-02-18-agent-authentication.md` 可看出:

```markdown
## Authentication Tiers

### Tier 1: Local Adapter (claude-local, codex-local)

Trust model: The adapter process runs on the same machine as the Paperclip
server. There is no meaningful network boundary.

Approach: Paperclip generates a token and passes it directly to the agent
process as a parameter/env var at invocation time. No manual setup required.

Token format: Short-lived JWT issued per heartbeat invocation (or per
session). The server mints the token, passes it in the adapter call, and
accepts it back on API requests.

Token lifetime considerations:
- Coding agents can run for hours, so tokens can't expire too quickly.
- Infinite-lived tokens are undesirable even in local contexts.
- Use JWTs with a generous expiry (e.g. 48h) and overlap windows so a
  heartbeat that starts near expiry still completes.
- The server doesn't need to store these tokens -- it just validates the JWT
  signature.

Status: Partially implemented. The local adapter already passes
PAPERCLIP_API_URL, PAPERCLIP_AGENT_ID, PAPERCLIP_COMPANY_ID. We need to
add a PAPERCLIP_API_KEY (JWT) to the set of injected env vars.
```

### 3.2 安全考虑
1. **Token 作为临时凭证**: 不应持久化，应由 server 动态生成
2. **自动注入**: 由 server 在 heartbeat 时自动创建和注入，无需手动干预
3. **与 Heartbeat 绑定**: Token 的有效期与 heartbeat 生命周期同步

## 4. 完整的 JWT Token 获取流程 (对用户而言)

```
步骤 1: 启动 Paperclip Server
  $ paperclip run
  或
  $ PAPERCLIP_AGENT_JWT_SECRET=<your-secret> paperclip run

步骤 2: Doctor 自动检查和修复
  如果 secret 缺失:
    $ paperclip doctor --repair
    → 自动生成 ~/.config/paperclip/.env
    → 包含 PAPERCLIP_AGENT_JWT_SECRET=<自动生成的值>

步骤 3: Server 动态生成 Token
  当 agent 触发 heartbeat 时:
    heartbeat.ts 
      → createLocalAgentJwt(agentId, companyId, adapterType, runId)
      → 返回有效期 48h 的 JWT token
      → 通过环境变量 PAPERCLIP_API_KEY 注入给 agent

步骤 4: Agent 自动使用 Token
  Agent 进程启动时:
    $ PAPERCLIP_API_KEY=<token> claude ...
    或
    $ PAPERCLIP_API_URL=... PAPERCLIP_API_KEY=<token> agent-process

步骤 5: API 请求时自动提交
  $ curl -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
         https://paperclip.example.com/api/...
```

## 5. 如果需要手动测试 JWT Token

### 选项 A: 运行单元测试
```bash
# 进入 server 目录
cd /Users/hans.pan/paperclip/server

# 运行 JWT 测试
npm test -- agent-auth-jwt.test.ts
```

### 选项 B: 写脚本直接调用
```typescript
import { createLocalAgentJwt, verifyLocalAgentJwt } from './src/agent-auth-jwt.js';

// 设置环境变量
process.env.PAPERCLIP_AGENT_JWT_SECRET = 'your-secret-key-here';

// 生成 token
const token = createLocalAgentJwt('agent-1', 'company-1', 'claude_local', 'run-1');
console.log('Generated token:', token);

// 验证 token
const claims = verifyLocalAgentJwt(token);
console.log('Claims:', claims);
```

### 选项 C: 从 Node REPL
```bash
$ node
> import { createLocalAgentJwt } from '/Users/hans.pan/paperclip/server/src/agent-auth-jwt.ts'
> process.env.PAPERCLIP_AGENT_JWT_SECRET = 'test-secret'
> const token = createLocalAgentJwt('agent-1', 'company-1', 'claude_local', 'run-1')
> console.log(token)
```

## 6. 可能在 scripts 目录中找到的相关脚本

```bash
# 搜索任何与 agent 或 token 相关的脚本
grep -r "agent\|token\|jwt" /Users/hans.pan/paperclip/scripts/ --include="*.sh" --include="*.ts"

# 结果: 
# 大部分是基础设施脚本 (docker, backup 等)，没有 JWT token 生成脚本
# 因为 JWT 是在 server runtime 动态生成的
```

## 7. 与长期 API Key 的区别

| 特性 | JWT Token | API Key |
|------|----------|---------|
| 生命周期 | 短期 (48h) | 长期 (直到撤销) |
| 生成方式 | Server 自动生成 | 用户在 UI 中创建 |
| 存储方式 | 不存储 (无状态验证) | 哈希存储在数据库 |
| 适用场景 | 本地 adapter (claude-local 等) | 远程 agent (webhook 等) |
| 验证方式 | 签名验证 | 数据库查询 |

**相关代码**: `/Users/hans.pan/paperclip/server/src/middleware/auth.ts` 行 83-123
- JWT 验证: `verifyLocalAgentJwt(token)`
- API Key 验证: 数据库查询 `agentApiKeys`

## 总结

1. **没有 CLI 生成 Token 的命令**: JWT 由 server 动态生成，每个 heartbeat 一个新 token
2. **有 CLI 管理 Secret 的工具**: `paperclip doctor --repair` 自动创建 JWT Secret
3. **有 CLI 检查配置的工具**: `paperclip doctor` 检查 JWT Secret 是否正确配置
4. **Token 自动注入**: Agent 通过环境变量 `PAPERCLIP_API_KEY` 自动获得 token
5. **可测试性强**: 单元测试覆盖完整，可在测试中直接生成和验证 token

