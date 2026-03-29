# Paperclip 数据库 Schema 分析

> 基于 `packages/db/src/schema/` 目录中的 Drizzle ORM 定义生成。

---

## 1. 所有表及字段清单

### 1.1 认证相关表（Auth Tables）

#### `user`（用户表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | text PK | 用户 ID |
| name | text NOT NULL | 用户名称 |
| email | text NOT NULL | 邮箱 |
| email_verified | boolean NOT NULL DEFAULT false | 邮箱是否验证 |
| image | text | 头像 URL |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `session`（会话表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | text PK | 会话 ID |
| expires_at | timestamptz NOT NULL | 过期时间 |
| token | text NOT NULL | 会话令牌 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |
| ip_address | text | 客户端 IP |
| user_agent | text | 浏览器 UA |
| user_id | text NOT NULL FK -> user.id | 所属用户 |

#### `account`（第三方账户表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | text PK | 账户 ID |
| account_id | text NOT NULL | 第三方账户 ID |
| provider_id | text NOT NULL | 提供者标识 |
| user_id | text NOT NULL FK -> user.id | 所属用户 |
| access_token | text | 访问令牌 |
| refresh_token | text | 刷新令牌 |
| id_token | text | ID 令牌 |
| access_token_expires_at | timestamptz | 访问令牌过期时间 |
| refresh_token_expires_at | timestamptz | 刷新令牌过期时间 |
| scope | text | 授权范围 |
| password | text | 密码（密码登录时） |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `verification`（验证表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | text PK | 验证 ID |
| identifier | text NOT NULL | 验证标识符 |
| value | text NOT NULL | 验证值 |
| expires_at | timestamptz NOT NULL | 过期时间 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

#### `instance_user_roles`（实例用户角色表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| user_id | text NOT NULL | 用户 ID |
| role | text NOT NULL DEFAULT 'instance_admin' | 角色（实例级别） |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

---

### 1.2 公司核心表

#### `companies`（公司表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| name | text NOT NULL | 公司名称 |
| description | text | 描述 |
| status | text NOT NULL DEFAULT 'active' | 状态 (active/paused/archived) |
| issue_prefix | text NOT NULL DEFAULT 'PAP' | Issue 编号前缀（唯一） |
| issue_counter | integer NOT NULL DEFAULT 0 | Issue 编号计数器 |
| budget_monthly_cents | integer NOT NULL DEFAULT 0 | 月度预算（美分） |
| spent_monthly_cents | integer NOT NULL DEFAULT 0 | 月度已花费（美分） |
| require_board_approval_for_new_agents | boolean NOT NULL DEFAULT true | 新 Agent 是否需要董事会审批 |
| brand_color | text | 品牌颜色 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `company_memberships`（公司成员关系表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| principal_type | text NOT NULL | 主体类型（user/agent） |
| principal_id | text NOT NULL | 主体 ID |
| status | text NOT NULL DEFAULT 'active' | 成员状态 |
| membership_role | text | 成员角色 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `principal_permission_grants`（权限授予表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| principal_type | text NOT NULL | 主体类型 |
| principal_id | text NOT NULL | 主体 ID |
| permission_key | text NOT NULL | 权限标识 |
| scope | jsonb | 权限作用域 |
| granted_by_user_id | text | 授权者用户 ID |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

---

### 1.3 Agent 相关表

#### `agents`（Agent 表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| name | text NOT NULL | Agent 名称 |
| role | text NOT NULL DEFAULT 'general' | 角色 |
| title | text | 职称 |
| icon | text | 图标 |
| status | text NOT NULL DEFAULT 'idle' | 状态 (idle/running/paused/error/terminated) |
| reports_to | uuid FK -> agents.id | 上级 Agent（自引用） |
| capabilities | text | 能力描述 |
| adapter_type | text NOT NULL DEFAULT 'process' | 适配器类型 (process/http) |
| adapter_config | jsonb NOT NULL DEFAULT {} | 适配器配置 |
| runtime_config | jsonb NOT NULL DEFAULT {} | 运行时配置 |
| budget_monthly_cents | integer NOT NULL DEFAULT 0 | 月度预算（美分） |
| spent_monthly_cents | integer NOT NULL DEFAULT 0 | 月度已花费（美分） |
| permissions | jsonb NOT NULL DEFAULT {} | Agent 权限 |
| last_heartbeat_at | timestamptz | 上次心跳时间 |
| metadata | jsonb | 元数据 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `agent_api_keys`（Agent API 密钥表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| agent_id | uuid NOT NULL FK -> agents.id | 所属 Agent |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| name | text NOT NULL | 密钥名称 |
| key_hash | text NOT NULL | 密钥哈希值 |
| last_used_at | timestamptz | 上次使用时间 |
| revoked_at | timestamptz | 撤销时间 |
| created_at | timestamptz NOT NULL | 创建时间 |

#### `agent_config_revisions`（Agent 配置修订表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| agent_id | uuid NOT NULL FK -> agents.id (CASCADE) | 所属 Agent |
| created_by_agent_id | uuid FK -> agents.id | 修改者 Agent |
| created_by_user_id | text | 修改者用户 |
| source | text NOT NULL DEFAULT 'patch' | 修改来源 |
| rolled_back_from_revision_id | uuid | 回滚来源修订 ID |
| changed_keys | jsonb NOT NULL DEFAULT [] | 变更的配置键列表 |
| before_config | jsonb NOT NULL | 变更前配置快照 |
| after_config | jsonb NOT NULL | 变更后配置快照 |
| created_at | timestamptz NOT NULL | 创建时间 |

#### `agent_runtime_state`（Agent 运行时状态表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| agent_id | uuid PK FK -> agents.id | Agent ID（主键） |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| adapter_type | text NOT NULL | 适配器类型 |
| session_id | text | 会话 ID |
| state_json | jsonb NOT NULL DEFAULT {} | 运行时状态 JSON |
| last_run_id | uuid | 最近运行 ID |
| last_run_status | text | 最近运行状态 |
| total_input_tokens | bigint NOT NULL DEFAULT 0 | 累计输入 token 数 |
| total_output_tokens | bigint NOT NULL DEFAULT 0 | 累计输出 token 数 |
| total_cached_input_tokens | bigint NOT NULL DEFAULT 0 | 累计缓存输入 token 数 |
| total_cost_cents | bigint NOT NULL DEFAULT 0 | 累计成本（美分） |
| last_error | text | 最近错误 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `agent_task_sessions`（Agent 任务会话表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| agent_id | uuid NOT NULL FK -> agents.id | 所属 Agent |
| adapter_type | text NOT NULL | 适配器类型 |
| task_key | text NOT NULL | 任务标识 |
| session_params_json | jsonb | 会话参数 |
| session_display_id | text | 会话展示 ID |
| last_run_id | uuid FK -> heartbeat_runs.id | 最近运行 ID |
| last_error | text | 最近错误 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `agent_wakeup_requests`（Agent 唤醒请求表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| agent_id | uuid NOT NULL FK -> agents.id | 目标 Agent |
| source | text NOT NULL | 唤醒来源 |
| trigger_detail | text | 触发详情 |
| reason | text | 唤醒原因 |
| payload | jsonb | 载荷数据 |
| status | text NOT NULL DEFAULT 'queued' | 状态 |
| coalesced_count | integer NOT NULL DEFAULT 0 | 合并计数 |
| requested_by_actor_type | text | 请求者类型 |
| requested_by_actor_id | text | 请求者 ID |
| idempotency_key | text | 幂等键 |
| run_id | uuid | 关联运行 ID |
| requested_at | timestamptz NOT NULL | 请求时间 |
| claimed_at | timestamptz | 认领时间 |
| finished_at | timestamptz | 完成时间 |
| error | text | 错误信息 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

---

### 1.4 目标与项目表

#### `goals`（目标表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| title | text NOT NULL | 目标标题 |
| description | text | 描述 |
| level | text NOT NULL DEFAULT 'task' | 级别 (company/team/agent/task) |
| status | text NOT NULL DEFAULT 'planned' | 状态 (planned/active/achieved/cancelled) |
| parent_id | uuid FK -> goals.id | 父目标（自引用） |
| owner_agent_id | uuid FK -> agents.id | 负责 Agent |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `projects`（项目表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| goal_id | uuid FK -> goals.id | 关联目标 |
| name | text NOT NULL | 项目名称 |
| description | text | 描述 |
| status | text NOT NULL DEFAULT 'backlog' | 状态 (backlog/planned/in_progress/completed/cancelled) |
| lead_agent_id | uuid FK -> agents.id | 负责人 Agent |
| target_date | date | 目标日期 |
| color | text | 颜色标识 |
| execution_workspace_policy | jsonb | 执行工作区策略 |
| archived_at | timestamptz | 归档时间 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `project_goals`（项目-目标关联表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| project_id | uuid NOT NULL FK -> projects.id (CASCADE) | 项目 ID（联合主键） |
| goal_id | uuid NOT NULL FK -> goals.id (CASCADE) | 目标 ID（联合主键） |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `project_workspaces`（项目工作区表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| project_id | uuid NOT NULL FK -> projects.id (CASCADE) | 所属项目 |
| name | text NOT NULL | 工作区名称 |
| cwd | text | 工作目录 |
| repo_url | text | 仓库 URL |
| repo_ref | text | 仓库分支/引用 |
| metadata | jsonb | 元数据 |
| is_primary | boolean NOT NULL DEFAULT false | 是否主工作区 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `workspace_runtime_services`（工作区运行时服务表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| project_id | uuid FK -> projects.id | 关联项目 |
| project_workspace_id | uuid FK -> project_workspaces.id | 关联工作区 |
| issue_id | uuid FK -> issues.id | 关联任务 |
| scope_type | text NOT NULL | 作用域类型 |
| scope_id | text | 作用域 ID |
| service_name | text NOT NULL | 服务名称 |
| status | text NOT NULL | 服务状态 |
| lifecycle | text NOT NULL | 生命周期 |
| reuse_key | text | 复用标识 |
| command | text | 启动命令 |
| cwd | text | 工作目录 |
| port | integer | 端口号 |
| url | text | 服务 URL |
| provider | text NOT NULL | 提供者 |
| provider_ref | text | 提供者引用 |
| owner_agent_id | uuid FK -> agents.id | 拥有者 Agent |
| started_by_run_id | uuid FK -> heartbeat_runs.id | 启动运行 ID |
| last_used_at | timestamptz NOT NULL | 最后使用时间 |
| started_at | timestamptz NOT NULL | 启动时间 |
| stopped_at | timestamptz | 停止时间 |
| stop_policy | jsonb | 停止策略 |
| health_status | text NOT NULL DEFAULT 'unknown' | 健康状态 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

---

### 1.5 任务（Issue）相关表

#### `issues`（任务/工单表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| project_id | uuid FK -> projects.id | 所属项目 |
| goal_id | uuid FK -> goals.id | 关联目标 |
| parent_id | uuid FK -> issues.id | 父任务（自引用） |
| title | text NOT NULL | 标题 |
| description | text | 描述 |
| status | text NOT NULL DEFAULT 'backlog' | 状态 |
| priority | text NOT NULL DEFAULT 'medium' | 优先级 (critical/high/medium/low) |
| assignee_agent_id | uuid FK -> agents.id | 受理 Agent |
| assignee_user_id | text | 受理用户 |
| checkout_run_id | uuid FK -> heartbeat_runs.id | 签出运行 ID |
| execution_run_id | uuid FK -> heartbeat_runs.id | 执行运行 ID |
| execution_agent_name_key | text | 执行 Agent 名称键 |
| execution_locked_at | timestamptz | 执行锁定时间 |
| created_by_agent_id | uuid FK -> agents.id | 创建者 Agent |
| created_by_user_id | text | 创建者用户 |
| issue_number | integer | Issue 编号 |
| identifier | text UNIQUE | Issue 唯一标识（如 PAP-123） |
| request_depth | integer NOT NULL DEFAULT 0 | 请求深度（跨团队委派跳数） |
| billing_code | text | 计费代码 |
| assignee_adapter_overrides | jsonb | 受理人适配器覆盖配置 |
| execution_workspace_settings | jsonb | 执行工作区设置 |
| started_at | timestamptz | 开始时间 |
| completed_at | timestamptz | 完成时间 |
| cancelled_at | timestamptz | 取消时间 |
| hidden_at | timestamptz | 隐藏时间 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `issue_comments`（任务评论表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| issue_id | uuid NOT NULL FK -> issues.id | 所属任务 |
| author_agent_id | uuid FK -> agents.id | 作者 Agent |
| author_user_id | text | 作者用户 |
| body | text NOT NULL | 评论内容 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `labels`（标签表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id (CASCADE) | 所属公司 |
| name | text NOT NULL | 标签名称（公司内唯一） |
| color | text NOT NULL | 颜色 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `issue_labels`（任务-标签关联表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| issue_id | uuid NOT NULL FK -> issues.id (CASCADE) | 任务 ID（联合主键） |
| label_id | uuid NOT NULL FK -> labels.id (CASCADE) | 标签 ID（联合主键） |
| company_id | uuid NOT NULL FK -> companies.id (CASCADE) | 所属公司 |
| created_at | timestamptz NOT NULL | 创建时间 |

#### `issue_read_states`（任务已读状态表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| issue_id | uuid NOT NULL FK -> issues.id | 任务 ID |
| user_id | text NOT NULL | 用户 ID |
| last_read_at | timestamptz NOT NULL | 最后阅读时间 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `issue_attachments`（任务附件表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| issue_id | uuid NOT NULL FK -> issues.id (CASCADE) | 所属任务 |
| asset_id | uuid NOT NULL FK -> assets.id (CASCADE) | 资产 ID |
| issue_comment_id | uuid FK -> issue_comments.id | 关联评论 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `issue_approvals`（任务-审批关联表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| issue_id | uuid NOT NULL FK -> issues.id (CASCADE) | 任务 ID（联合主键） |
| approval_id | uuid NOT NULL FK -> approvals.id (CASCADE) | 审批 ID（联合主键） |
| linked_by_agent_id | uuid FK -> agents.id | 关联者 Agent |
| linked_by_user_id | text | 关联者用户 |
| created_at | timestamptz NOT NULL | 创建时间 |

---

### 1.6 心跳运行表

#### `heartbeat_runs`（心跳运行记录表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| agent_id | uuid NOT NULL FK -> agents.id | 所属 Agent |
| invocation_source | text NOT NULL DEFAULT 'on_demand' | 调用来源 |
| trigger_detail | text | 触发详情 |
| status | text NOT NULL DEFAULT 'queued' | 状态 (queued/running/succeeded/failed/cancelled/timed_out) |
| started_at | timestamptz | 开始时间 |
| finished_at | timestamptz | 结束时间 |
| error | text | 错误信息 |
| wakeup_request_id | uuid FK -> agent_wakeup_requests.id | 关联唤醒请求 |
| exit_code | integer | 进程退出码 |
| signal | text | 终止信号 |
| usage_json | jsonb | 使用量数据 |
| result_json | jsonb | 结果数据 |
| session_id_before | text | 运行前会话 ID |
| session_id_after | text | 运行后会话 ID |
| log_store | text | 日志存储位置 |
| log_ref | text | 日志引用 |
| log_bytes | bigint | 日志字节数 |
| log_sha256 | text | 日志哈希 |
| log_compressed | boolean NOT NULL DEFAULT false | 日志是否压缩 |
| stdout_excerpt | text | 标准输出摘录 |
| stderr_excerpt | text | 标准错误摘录 |
| error_code | text | 错误代码 |
| external_run_id | text | 外部运行 ID |
| context_snapshot | jsonb | 上下文快照 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `heartbeat_run_events`（心跳运行事件表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | bigserial PK | 自增主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| run_id | uuid NOT NULL FK -> heartbeat_runs.id | 所属运行 |
| agent_id | uuid NOT NULL FK -> agents.id | 所属 Agent |
| seq | integer NOT NULL | 序列号 |
| event_type | text NOT NULL | 事件类型 |
| stream | text | 流类型 |
| level | text | 日志级别 |
| color | text | 颜色 |
| message | text | 消息内容 |
| payload | jsonb | 载荷 |
| created_at | timestamptz NOT NULL | 创建时间 |

---

### 1.7 成本与预算表

#### `cost_events`（成本事件表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| agent_id | uuid NOT NULL FK -> agents.id | 所属 Agent |
| issue_id | uuid FK -> issues.id | 关联任务 |
| project_id | uuid FK -> projects.id | 关联项目 |
| goal_id | uuid FK -> goals.id | 关联目标 |
| billing_code | text | 计费代码 |
| provider | text NOT NULL | LLM 提供商 |
| model | text NOT NULL | 模型名称 |
| input_tokens | integer NOT NULL DEFAULT 0 | 输入 token 数 |
| output_tokens | integer NOT NULL DEFAULT 0 | 输出 token 数 |
| cost_cents | integer NOT NULL | 成本（美分） |
| occurred_at | timestamptz NOT NULL | 发生时间 |
| created_at | timestamptz NOT NULL | 创建时间 |

---

### 1.8 审批相关表

#### `approvals`（审批表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| type | text NOT NULL | 审批类型 (hire_agent/approve_ceo_strategy) |
| requested_by_agent_id | uuid FK -> agents.id | 请求者 Agent |
| requested_by_user_id | text | 请求者用户 |
| status | text NOT NULL DEFAULT 'pending' | 状态 (pending/approved/rejected/cancelled) |
| payload | jsonb NOT NULL | 审批载荷 |
| decision_note | text | 决策说明 |
| decided_by_user_id | text | 决策者用户 ID |
| decided_at | timestamptz | 决策时间 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `approval_comments`（审批评论表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| approval_id | uuid NOT NULL FK -> approvals.id | 所属审批 |
| author_agent_id | uuid FK -> agents.id | 作者 Agent |
| author_user_id | text | 作者用户 |
| body | text NOT NULL | 评论内容 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

---

### 1.9 审计与活动日志

#### `activity_log`（活动日志表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| actor_type | text NOT NULL DEFAULT 'system' | 操作者类型 (agent/user/system) |
| actor_id | text NOT NULL | 操作者 ID |
| action | text NOT NULL | 操作动作 |
| entity_type | text NOT NULL | 实体类型 |
| entity_id | text NOT NULL | 实体 ID |
| agent_id | uuid FK -> agents.id | 关联 Agent |
| run_id | uuid FK -> heartbeat_runs.id | 关联运行 |
| details | jsonb | 详细信息 |
| created_at | timestamptz NOT NULL | 创建时间 |

---

### 1.10 资产与密钥管理表

#### `assets`（资产/文件表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| provider | text NOT NULL | 存储提供者 (local_disk/s3) |
| object_key | text NOT NULL | 对象键（公司内唯一） |
| content_type | text NOT NULL | 内容类型 (MIME) |
| byte_size | integer NOT NULL | 文件大小（字节） |
| sha256 | text NOT NULL | 文件哈希 |
| original_filename | text | 原始文件名 |
| created_by_agent_id | uuid FK -> agents.id | 创建者 Agent |
| created_by_user_id | text | 创建者用户 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `company_secrets`（公司密钥表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid NOT NULL FK -> companies.id | 所属公司 |
| name | text NOT NULL | 密钥名称（公司内唯一） |
| provider | text NOT NULL DEFAULT 'local_encrypted' | 密钥提供者 |
| external_ref | text | 外部引用 |
| latest_version | integer NOT NULL DEFAULT 1 | 最新版本号 |
| description | text | 描述 |
| created_by_agent_id | uuid FK -> agents.id | 创建者 Agent |
| created_by_user_id | text | 创建者用户 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `company_secret_versions`（公司密钥版本表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| secret_id | uuid NOT NULL FK -> company_secrets.id (CASCADE) | 所属密钥 |
| version | integer NOT NULL | 版本号（密钥内唯一） |
| material | jsonb NOT NULL | 加密/引用材料 |
| value_sha256 | text NOT NULL | 值哈希 |
| created_by_agent_id | uuid FK -> agents.id | 创建者 Agent |
| created_by_user_id | text | 创建者用户 |
| created_at | timestamptz NOT NULL | 创建时间 |
| revoked_at | timestamptz | 撤销时间 |

---

### 1.11 邀请与加入请求表

#### `invites`（邀请表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| company_id | uuid FK -> companies.id | 关联公司 |
| invite_type | text NOT NULL DEFAULT 'company_join' | 邀请类型 |
| token_hash | text NOT NULL UNIQUE | 令牌哈希 |
| allowed_join_types | text NOT NULL DEFAULT 'both' | 允许的加入方式 |
| defaults_payload | jsonb | 默认配置载荷 |
| expires_at | timestamptz NOT NULL | 过期时间 |
| invited_by_user_id | text | 邀请者用户 ID |
| revoked_at | timestamptz | 撤销时间 |
| accepted_at | timestamptz | 接受时间 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

#### `join_requests`（加入请求表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | uuid PK | 主键 |
| invite_id | uuid NOT NULL FK -> invites.id UNIQUE | 关联邀请 |
| company_id | uuid NOT NULL FK -> companies.id | 目标公司 |
| request_type | text NOT NULL | 请求类型 |
| status | text NOT NULL DEFAULT 'pending_approval' | 状态 |
| request_ip | text NOT NULL | 请求 IP |
| requesting_user_id | text | 请求用户 ID |
| request_email_snapshot | text | 请求者邮箱快照 |
| agent_name | text | Agent 名称 |
| adapter_type | text | 适配器类型 |
| capabilities | text | 能力描述 |
| agent_defaults_payload | jsonb | Agent 默认配置 |
| claim_secret_hash | text | 认领密钥哈希 |
| claim_secret_expires_at | timestamptz | 认领密钥过期时间 |
| claim_secret_consumed_at | timestamptz | 认领密钥使用时间 |
| created_agent_id | uuid FK -> agents.id | 创建的 Agent ID |
| approved_by_user_id | text | 批准者用户 ID |
| approved_at | timestamptz | 批准时间 |
| rejected_by_user_id | text | 拒绝者用户 ID |
| rejected_at | timestamptz | 拒绝时间 |
| created_at | timestamptz NOT NULL | 创建时间 |
| updated_at | timestamptz NOT NULL | 更新时间 |

---

## 2. 表之间的外键关系

### 2.1 核心外键关系汇总

| 源表 | 源字段 | 目标表 | 目标字段 | 说明 |
|------|--------|--------|----------|------|
| session | user_id | user | id | 会话归属用户 |
| account | user_id | user | id | 第三方账户归属用户 |
| agents | company_id | companies | id | Agent 归属公司 |
| agents | reports_to | agents | id | Agent 上级（自引用） |
| agent_api_keys | agent_id | agents | id | API Key 归属 Agent |
| agent_api_keys | company_id | companies | id | API Key 归属公司 |
| agent_config_revisions | company_id | companies | id | 配置修订归属公司 |
| agent_config_revisions | agent_id | agents | id | 配置修订归属 Agent |
| agent_runtime_state | agent_id | agents | id | 运行时状态归属 Agent |
| agent_runtime_state | company_id | companies | id | 运行时状态归属公司 |
| agent_task_sessions | company_id | companies | id | 任务会话归属公司 |
| agent_task_sessions | agent_id | agents | id | 任务会话归属 Agent |
| agent_task_sessions | last_run_id | heartbeat_runs | id | 最近运行 |
| agent_wakeup_requests | company_id | companies | id | 唤醒请求归属公司 |
| agent_wakeup_requests | agent_id | agents | id | 唤醒请求目标 Agent |
| goals | company_id | companies | id | 目标归属公司 |
| goals | parent_id | goals | id | 父目标（自引用） |
| goals | owner_agent_id | agents | id | 目标负责 Agent |
| projects | company_id | companies | id | 项目归属公司 |
| projects | goal_id | goals | id | 项目关联目标 |
| projects | lead_agent_id | agents | id | 项目负责人 |
| project_goals | project_id | projects | id | 项目-目标多对多 |
| project_goals | goal_id | goals | id | 项目-目标多对多 |
| project_goals | company_id | companies | id | 归属公司 |
| project_workspaces | company_id | companies | id | 工作区归属公司 |
| project_workspaces | project_id | projects | id | 工作区归属项目 |
| workspace_runtime_services | company_id | companies | id | 服务归属公司 |
| workspace_runtime_services | project_id | projects | id | 服务关联项目 |
| workspace_runtime_services | project_workspace_id | project_workspaces | id | 服务关联工作区 |
| workspace_runtime_services | issue_id | issues | id | 服务关联任务 |
| workspace_runtime_services | owner_agent_id | agents | id | 服务拥有者 |
| workspace_runtime_services | started_by_run_id | heartbeat_runs | id | 启动运行 |
| issues | company_id | companies | id | 任务归属公司 |
| issues | project_id | projects | id | 任务归属项目 |
| issues | goal_id | goals | id | 任务关联目标 |
| issues | parent_id | issues | id | 父任务（自引用） |
| issues | assignee_agent_id | agents | id | 受理 Agent |
| issues | created_by_agent_id | agents | id | 创建者 Agent |
| issues | checkout_run_id | heartbeat_runs | id | 签出运行 |
| issues | execution_run_id | heartbeat_runs | id | 执行运行 |
| issue_comments | company_id | companies | id | 评论归属公司 |
| issue_comments | issue_id | issues | id | 评论归属任务 |
| issue_comments | author_agent_id | agents | id | 作者 Agent |
| issue_attachments | company_id | companies | id | 附件归属公司 |
| issue_attachments | issue_id | issues | id | 附件归属任务 |
| issue_attachments | asset_id | assets | id | 关联资产 |
| issue_attachments | issue_comment_id | issue_comments | id | 关联评论 |
| issue_labels | issue_id | issues | id | 任务-标签关联 |
| issue_labels | label_id | labels | id | 任务-标签关联 |
| issue_labels | company_id | companies | id | 归属公司 |
| issue_approvals | company_id | companies | id | 归属公司 |
| issue_approvals | issue_id | issues | id | 关联任务 |
| issue_approvals | approval_id | approvals | id | 关联审批 |
| issue_read_states | company_id | companies | id | 归属公司 |
| issue_read_states | issue_id | issues | id | 关联任务 |
| labels | company_id | companies | id | 标签归属公司 |
| heartbeat_runs | company_id | companies | id | 运行归属公司 |
| heartbeat_runs | agent_id | agents | id | 运行归属 Agent |
| heartbeat_runs | wakeup_request_id | agent_wakeup_requests | id | 关联唤醒请求 |
| heartbeat_run_events | company_id | companies | id | 事件归属公司 |
| heartbeat_run_events | run_id | heartbeat_runs | id | 事件归属运行 |
| heartbeat_run_events | agent_id | agents | id | 事件归属 Agent |
| cost_events | company_id | companies | id | 成本归属公司 |
| cost_events | agent_id | agents | id | 成本归属 Agent |
| cost_events | issue_id | issues | id | 关联任务 |
| cost_events | project_id | projects | id | 关联项目 |
| cost_events | goal_id | goals | id | 关联目标 |
| approvals | company_id | companies | id | 审批归属公司 |
| approvals | requested_by_agent_id | agents | id | 请求者 Agent |
| approval_comments | company_id | companies | id | 评论归属公司 |
| approval_comments | approval_id | approvals | id | 评论归属审批 |
| approval_comments | author_agent_id | agents | id | 作者 Agent |
| activity_log | company_id | companies | id | 日志归属公司 |
| activity_log | agent_id | agents | id | 关联 Agent |
| activity_log | run_id | heartbeat_runs | id | 关联运行 |
| assets | company_id | companies | id | 资产归属公司 |
| assets | created_by_agent_id | agents | id | 创建者 Agent |
| company_secrets | company_id | companies | id | 密钥归属公司 |
| company_secrets | created_by_agent_id | agents | id | 创建者 Agent |
| company_secret_versions | secret_id | company_secrets | id | 版本归属密钥 |
| company_secret_versions | created_by_agent_id | agents | id | 创建者 Agent |
| company_memberships | company_id | companies | id | 成员关系归属公司 |
| principal_permission_grants | company_id | companies | id | 权限归属公司 |
| invites | company_id | companies | id | 邀请关联公司 |
| join_requests | invite_id | invites | id | 请求关联邀请 |
| join_requests | company_id | companies | id | 请求关联公司 |
| join_requests | created_agent_id | agents | id | 创建的 Agent |

---

## 3. ER 图（Mermaid erDiagram）

```mermaid
erDiagram
    %% ===== Auth =====
    user {
        text id PK
        text name
        text email
        boolean email_verified
        text image
        timestamptz created_at
        timestamptz updated_at
    }
    session {
        text id PK
        timestamptz expires_at
        text token
        text ip_address
        text user_agent
        text user_id FK
    }
    account {
        text id PK
        text account_id
        text provider_id
        text user_id FK
        text access_token
        text refresh_token
        text id_token
    }
    verification {
        text id PK
        text identifier
        text value
        timestamptz expires_at
    }
    instance_user_roles {
        uuid id PK
        text user_id
        text role
    }

    user ||--o{ session : "has"
    user ||--o{ account : "has"

    %% ===== Company Core =====
    companies {
        uuid id PK
        text name
        text description
        text status
        text issue_prefix
        integer issue_counter
        integer budget_monthly_cents
        integer spent_monthly_cents
        boolean require_board_approval_for_new_agents
        text brand_color
    }
    company_memberships {
        uuid id PK
        uuid company_id FK
        text principal_type
        text principal_id
        text status
        text membership_role
    }
    principal_permission_grants {
        uuid id PK
        uuid company_id FK
        text principal_type
        text principal_id
        text permission_key
        jsonb scope
    }

    companies ||--o{ company_memberships : "has members"
    companies ||--o{ principal_permission_grants : "has grants"

    %% ===== Agents =====
    agents {
        uuid id PK
        uuid company_id FK
        text name
        text role
        text title
        text status
        uuid reports_to FK
        text adapter_type
        jsonb adapter_config
        jsonb runtime_config
        integer budget_monthly_cents
        integer spent_monthly_cents
    }
    agent_api_keys {
        uuid id PK
        uuid agent_id FK
        uuid company_id FK
        text name
        text key_hash
    }
    agent_config_revisions {
        uuid id PK
        uuid company_id FK
        uuid agent_id FK
        text source
        jsonb changed_keys
        jsonb before_config
        jsonb after_config
    }
    agent_runtime_state {
        uuid agent_id PK_FK
        uuid company_id FK
        text adapter_type
        text session_id
        jsonb state_json
        bigint total_input_tokens
        bigint total_output_tokens
        bigint total_cost_cents
    }
    agent_task_sessions {
        uuid id PK
        uuid company_id FK
        uuid agent_id FK
        text adapter_type
        text task_key
        uuid last_run_id FK
    }
    agent_wakeup_requests {
        uuid id PK
        uuid company_id FK
        uuid agent_id FK
        text source
        text status
        text reason
        uuid run_id
    }

    companies ||--o{ agents : "employs"
    agents ||--o| agents : "reports_to"
    agents ||--o{ agent_api_keys : "has keys"
    companies ||--o{ agent_api_keys : "scopes"
    agents ||--o{ agent_config_revisions : "has revisions"
    agents ||--|| agent_runtime_state : "has state"
    agents ||--o{ agent_task_sessions : "has sessions"
    agents ||--o{ agent_wakeup_requests : "receives"

    %% ===== Goals =====
    goals {
        uuid id PK
        uuid company_id FK
        text title
        text level
        text status
        uuid parent_id FK
        uuid owner_agent_id FK
    }

    companies ||--o{ goals : "has"
    goals ||--o| goals : "parent"
    agents ||--o{ goals : "owns"

    %% ===== Projects =====
    projects {
        uuid id PK
        uuid company_id FK
        uuid goal_id FK
        text name
        text status
        uuid lead_agent_id FK
        date target_date
    }
    project_goals {
        uuid project_id PK_FK
        uuid goal_id PK_FK
        uuid company_id FK
    }
    project_workspaces {
        uuid id PK
        uuid company_id FK
        uuid project_id FK
        text name
        text cwd
        text repo_url
        boolean is_primary
    }
    workspace_runtime_services {
        uuid id PK
        uuid company_id FK
        uuid project_id FK
        uuid project_workspace_id FK
        uuid issue_id FK
        text service_name
        text status
        uuid owner_agent_id FK
        uuid started_by_run_id FK
    }

    companies ||--o{ projects : "has"
    goals ||--o{ projects : "linked via goal_id"
    agents ||--o{ projects : "leads"
    projects ||--o{ project_goals : "many-to-many goals"
    goals ||--o{ project_goals : "many-to-many projects"
    projects ||--o{ project_workspaces : "has workspaces"
    project_workspaces ||--o{ workspace_runtime_services : "runs services"

    %% ===== Issues =====
    issues {
        uuid id PK
        uuid company_id FK
        uuid project_id FK
        uuid goal_id FK
        uuid parent_id FK
        text title
        text status
        text priority
        uuid assignee_agent_id FK
        text assignee_user_id
        uuid checkout_run_id FK
        uuid execution_run_id FK
        integer issue_number
        text identifier
        integer request_depth
        text billing_code
    }
    issue_comments {
        uuid id PK
        uuid company_id FK
        uuid issue_id FK
        uuid author_agent_id FK
        text author_user_id
        text body
    }
    labels {
        uuid id PK
        uuid company_id FK
        text name
        text color
    }
    issue_labels {
        uuid issue_id PK_FK
        uuid label_id PK_FK
        uuid company_id FK
    }
    issue_read_states {
        uuid id PK
        uuid company_id FK
        uuid issue_id FK
        text user_id
        timestamptz last_read_at
    }
    issue_attachments {
        uuid id PK
        uuid company_id FK
        uuid issue_id FK
        uuid asset_id FK
        uuid issue_comment_id FK
    }
    issue_approvals {
        uuid issue_id PK_FK
        uuid approval_id PK_FK
        uuid company_id FK
        uuid linked_by_agent_id FK
    }

    companies ||--o{ issues : "has"
    projects ||--o{ issues : "contains"
    goals ||--o{ issues : "linked"
    issues ||--o| issues : "parent"
    agents ||--o{ issues : "assigned to"
    issues ||--o{ issue_comments : "has"
    agents ||--o{ issue_comments : "authors"
    companies ||--o{ labels : "has"
    issues ||--o{ issue_labels : "tagged"
    labels ||--o{ issue_labels : "applied to"
    issues ||--o{ issue_read_states : "read by"
    issues ||--o{ issue_attachments : "has"
    issues ||--o{ issue_approvals : "linked"

    %% ===== Heartbeat =====
    heartbeat_runs {
        uuid id PK
        uuid company_id FK
        uuid agent_id FK
        text invocation_source
        text status
        uuid wakeup_request_id FK
        integer exit_code
        jsonb usage_json
        jsonb result_json
    }
    heartbeat_run_events {
        bigserial id PK
        uuid company_id FK
        uuid run_id FK
        uuid agent_id FK
        integer seq
        text event_type
        text message
    }

    companies ||--o{ heartbeat_runs : "has"
    agents ||--o{ heartbeat_runs : "runs"
    agent_wakeup_requests ||--o{ heartbeat_runs : "triggers"
    heartbeat_runs ||--o{ heartbeat_run_events : "emits"
    heartbeat_runs ||--o{ issues : "checkout_run"
    heartbeat_runs ||--o{ issues : "execution_run"

    %% ===== Cost =====
    cost_events {
        uuid id PK
        uuid company_id FK
        uuid agent_id FK
        uuid issue_id FK
        uuid project_id FK
        uuid goal_id FK
        text provider
        text model
        integer input_tokens
        integer output_tokens
        integer cost_cents
        timestamptz occurred_at
    }

    companies ||--o{ cost_events : "has"
    agents ||--o{ cost_events : "incurs"
    issues ||--o{ cost_events : "tracked"
    projects ||--o{ cost_events : "tracked"
    goals ||--o{ cost_events : "tracked"

    %% ===== Approvals =====
    approvals {
        uuid id PK
        uuid company_id FK
        text type
        uuid requested_by_agent_id FK
        text status
        jsonb payload
        text decided_by_user_id
    }
    approval_comments {
        uuid id PK
        uuid company_id FK
        uuid approval_id FK
        uuid author_agent_id FK
        text body
    }

    companies ||--o{ approvals : "has"
    agents ||--o{ approvals : "requests"
    approvals ||--o{ approval_comments : "has"
    approvals ||--o{ issue_approvals : "linked to issues"

    %% ===== Activity Log =====
    activity_log {
        uuid id PK
        uuid company_id FK
        text actor_type
        text actor_id
        text action
        text entity_type
        text entity_id
        uuid agent_id FK
        uuid run_id FK
    }

    companies ||--o{ activity_log : "has"
    agents ||--o{ activity_log : "related"
    heartbeat_runs ||--o{ activity_log : "related"

    %% ===== Assets =====
    assets {
        uuid id PK
        uuid company_id FK
        text provider
        text object_key
        text content_type
        integer byte_size
        text sha256
    }

    companies ||--o{ assets : "has"
    assets ||--|| issue_attachments : "attached"

    %% ===== Secrets =====
    company_secrets {
        uuid id PK
        uuid company_id FK
        text name
        text provider
        integer latest_version
    }
    company_secret_versions {
        uuid id PK
        uuid secret_id FK
        integer version
        jsonb material
        text value_sha256
    }

    companies ||--o{ company_secrets : "has"
    company_secrets ||--o{ company_secret_versions : "has versions"

    %% ===== Invites & Join Requests =====
    invites {
        uuid id PK
        uuid company_id FK
        text invite_type
        text token_hash
        timestamptz expires_at
    }
    join_requests {
        uuid id PK
        uuid invite_id FK
        uuid company_id FK
        text request_type
        text status
        uuid created_agent_id FK
    }

    companies ||--o{ invites : "has"
    invites ||--|| join_requests : "generates"
    companies ||--o{ join_requests : "receives"
```

---

## 4. Company-Scoped 表标注

以下表包含 `company_id` 外键，属于 **company-scoped**（公司作用域）表：

| 表名 | 说明 |
|------|------|
| `agents` | Agent 员工 |
| `agent_api_keys` | Agent API 密钥 |
| `agent_config_revisions` | Agent 配置修订 |
| `agent_runtime_state` | Agent 运行时状态 |
| `agent_task_sessions` | Agent 任务会话 |
| `agent_wakeup_requests` | Agent 唤醒请求 |
| `goals` | 目标 |
| `projects` | 项目 |
| `project_goals` | 项目-目标关联 |
| `project_workspaces` | 项目工作区 |
| `workspace_runtime_services` | 工作区运行时服务 |
| `issues` | 任务/工单 |
| `issue_comments` | 任务评论 |
| `issue_labels` | 任务-标签关联 |
| `issue_read_states` | 任务已读状态 |
| `issue_attachments` | 任务附件 |
| `issue_approvals` | 任务-审批关联 |
| `labels` | 标签 |
| `heartbeat_runs` | 心跳运行记录 |
| `heartbeat_run_events` | 心跳运行事件 |
| `cost_events` | 成本事件 |
| `approvals` | 审批 |
| `approval_comments` | 审批评论 |
| `activity_log` | 活动日志 |
| `assets` | 资产/文件 |
| `company_secrets` | 公司密钥 |
| `company_memberships` | 公司成员关系 |
| `principal_permission_grants` | 权限授予 |
| `invites` | 邀请 |
| `join_requests` | 加入请求 |

### 非 Company-Scoped 表

| 表名 | 说明 |
|------|------|
| `companies` | 公司表本身（顶层实体） |
| `user` | 用户表（Better Auth 管理） |
| `session` | 会话表（Better Auth 管理） |
| `account` | 第三方账户表（Better Auth 管理） |
| `verification` | 验证表（Better Auth 管理） |
| `instance_user_roles` | 实例级用户角色（跨公司） |
| `company_secret_versions` | 密钥版本（通过 secret_id 间接关联公司） |
