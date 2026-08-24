UPDATE agents
SET model = CASE
  WHEN name LIKE '%CEO%'
    OR title LIKE '%首席%'
    OR title LIKE '%负责人%'
    OR title LIKE '%董事会秘书%'
    OR title LIKE '%主编%'
    OR title LIKE '%策略分析师%'
    OR title LIKE '%新闻分析师%'
    OR title LIKE '%舆情分析师%'
    OR title LIKE '%风险控制%'
    OR title LIKE '%风控%'
    OR title LIKE '%战略%'
    OR title LIKE '%规划%'
    OR title LIKE '%统筹%'
    OR title LIKE '%决策%'
    OR title LIKE '%架构%'
    OR title LIKE '%主管%'
    OR title LIKE '%总监%'
  THEN 'deepseek-v4-pro'
  ELSE 'deepseek-v4-flash'
END,
updated_at = CURRENT_TIMESTAMP;

INSERT INTO activity (id,type,summary,actor)
VALUES (
  lower(hex(randomblob(16))),
  'model',
  '启用 DeepSeek V4 职责分层：统筹规划使用 Pro，基础执行使用 Flash',
  '系统'
);
