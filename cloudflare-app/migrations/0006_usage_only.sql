UPDATE agents SET monthly_token_budget = 0;

UPDATE agents SET current_task = '复核 Token 用量' WHERE id = 'hq-005' AND current_task IS NOT NULL;
UPDATE tasks
SET title = '建立模型 Token 用量监控',
    description = '按事业部和 Agent 记录输入、输出与总 Token，观察用量趋势和异常增长；限额统一在 DeepSeek 开发者后台管理。'
WHERE id = 'task-budget';
UPDATE goals
SET title = '保持模型 Token 使用透明可控',
    description = '准确记录 Agent 的真实 Token 用量，并把高能力模型用于高价值判断。',
    metric = 'Token 用量可见性'
WHERE id = 'goal-cost';
UPDATE reports
SET summary = '当前 Token 用量已实现分层记录，高能力模型应只用于高价值判断。',
    content = '## 本周概览\n系统按运行、Agent 与事业部记录真实 Token 用量，不在 BitWorld 内设置配额。\n\n## 优化建议\n采集、翻译和格式化任务优先使用 Flash；复杂推理保留给 CEO 与风控角色。限额统一在 DeepSeek 开发者后台管理。'
WHERE id = 'report-budget';

DELETE FROM approvals WHERE id = 'approval-model-budget';

UPDATE activity
SET summary = '完成本月 Agent Token 用量复核'
WHERE id = 'activity-3';
UPDATE activity
SET summary = '预算与用量已切换为真实 Token 统计'
WHERE summary = '预算与用量已切换为 Token 配额统计';

INSERT INTO activity (id,type,summary,actor)
VALUES (
  lower(hex(randomblob(16))),
  'usage',
  '已取消 BitWorld 内部 Token 配额，系统仅记录真实用量',
  '系统'
);
