ALTER TABLE agents ADD COLUMN monthly_token_budget INTEGER NOT NULL DEFAULT 1000000;
ALTER TABLE agents ADD COLUMN monthly_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN monthly_output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN monthly_tokens_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN token_period TEXT NOT NULL DEFAULT '';

ALTER TABLE runs ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0;

UPDATE agents
SET monthly_token_budget = CAST(monthly_budget * 100000 AS INTEGER),
    monthly_input_tokens = 0,
    monthly_output_tokens = 0,
    monthly_tokens_used = 0,
    token_period = strftime('%Y-%m', 'now');

UPDATE agents SET current_task = '复核 Token 配额' WHERE id = 'hq-005' AND current_task IS NOT NULL;
UPDATE tasks
SET title = '建立模型 Token 用量红线',
    description = '将月度 Token 配额拆到事业部和 Agent，定义 80% 提醒和 100% 暂停规则。'
WHERE id = 'task-budget';
UPDATE goals
SET title = '模型 Token 使用保持在配额内',
    description = '确保 Agent 在月度 Token 配额内运行，并把高能力模型用于高价值判断。',
    metric = 'Token 配额健康度'
WHERE id = 'goal-cost';
UPDATE reports
SET title = '模型 Token 用量周报',
    summary = '当前 Token 配额健康，高能力模型应只用于高价值判断。',
    content = '## 本周概览\n整体 Token 用量处于配额内，研究与加密事业部占比较高。\n\n## 优化建议\n采集、翻译和格式化任务优先使用 Flash；复杂推理保留给 CEO 与风控角色。'
WHERE id = 'report-budget';
UPDATE approvals
SET title = '将 Research-001 单次任务上限提高到 20 万 Token',
    rationale = '深度研究任务需要更长上下文，但应仅限指定任务并记录实际 Token 用量。'
WHERE id = 'approval-model-budget';
UPDATE activity
SET summary = '完成本月 Agent Token 配额复核'
WHERE id = 'activity-3';

INSERT INTO activity (id,type,summary,actor)
VALUES (
  lower(hex(randomblob(16))),
  'budget',
  '预算与用量已切换为 Token 配额统计',
  '系统'
);
