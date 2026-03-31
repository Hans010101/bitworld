-- =================================================================
-- BitWorld 云端研究院 — 数据库初始化 SQL
-- 在迁移完成后执行此脚本
-- =================================================================

-- ===================== 公司 =====================

INSERT INTO companies (id, name, description, status, issue_prefix, issue_counter, budget_monthly_cents)
VALUES
  ('a1000000-0000-0000-0000-000000000001', 'BitWorld 总部', '集团总部，统筹管理各事业部', 'active', 'HQ', 0, 5000000),
  ('a2000000-0000-0000-0000-000000000002', '加密研究事业部', '提供专业的加密市场研究报告', 'active', 'CR', 0, 3000000);

-- ===================== Agent: 总部 =====================

-- HQ-001-CEO：集团 CEO
INSERT INTO agents (id, company_id, name, role, title, icon, status, adapter_type, adapter_config, runtime_config, budget_monthly_cents, permissions)
VALUES (
  'b1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'HQ-001-CEO', 'ceo', '集团首席执行官', 'crown', 'idle',
  'openai_compatible', '{}',
  '{"heartbeat": {"enabled": true, "intervalSec": 0, "wakeOnDemand": true, "maxConcurrentRuns": 1}}',
  2000000,
  '{"canCreateAgents": true}'
);

-- HQ-002-董秘：TG Bot 对接
INSERT INTO agents (id, company_id, name, role, title, icon, status, reports_to, adapter_type, adapter_config, runtime_config, budget_monthly_cents)
VALUES (
  'b1000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000001',
  'HQ-002-董秘', 'general', '集团董事会秘书', 'mail', 'idle',
  'b1000000-0000-0000-0000-000000000001',
  'openai_compatible', '{}',
  '{"heartbeat": {"enabled": true, "intervalSec": 0, "wakeOnDemand": true, "maxConcurrentRuns": 1}}',
  500000
);

-- HQ-003-预留：未来扩展
INSERT INTO agents (id, company_id, name, role, title, icon, status, reports_to, adapter_type, adapter_config, runtime_config, budget_monthly_cents)
VALUES (
  'b1000000-0000-0000-0000-000000000003',
  'a1000000-0000-0000-0000-000000000001',
  'HQ-003-预留', 'general', '预留扩展位', 'puzzle', 'idle',
  'b1000000-0000-0000-0000-000000000001',
  'openai_compatible', '{}',
  '{"heartbeat": {"enabled": false, "intervalSec": 0, "wakeOnDemand": false}}',
  0
);

-- ===================== Agent: 加密研究事业部 =====================

-- Crypto-001-CEO：事业部 CEO
INSERT INTO agents (id, company_id, name, role, title, icon, status, adapter_type, adapter_config, runtime_config, budget_monthly_cents, permissions)
VALUES (
  'b2000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000002',
  'Crypto-001-CEO', 'ceo', '加密研究事业部 CEO', 'brain', 'idle',
  'openai_compatible', '{}',
  '{"heartbeat": {"enabled": true, "intervalSec": 0, "wakeOnDemand": true, "maxConcurrentRuns": 1}}',
  1500000,
  '{"canCreateAgents": true}'
);

-- Crypto-002-行情：价格/交易量/链上数据
INSERT INTO agents (id, company_id, name, role, title, icon, status, reports_to, adapter_type, adapter_config, runtime_config, budget_monthly_cents)
VALUES (
  'b2000000-0000-0000-0000-000000000002',
  'a2000000-0000-0000-0000-000000000002',
  'Crypto-002-行情', 'researcher', '行情数据分析师', 'database', 'idle',
  'b2000000-0000-0000-0000-000000000001',
  'openai_compatible', '{}',
  '{"heartbeat": {"enabled": true, "intervalSec": 0, "wakeOnDemand": true, "maxConcurrentRuns": 1}}',
  500000
);

-- Crypto-003-新闻：新闻采集与影响力分析
INSERT INTO agents (id, company_id, name, role, title, icon, status, reports_to, adapter_type, adapter_config, runtime_config, budget_monthly_cents)
VALUES (
  'b2000000-0000-0000-0000-000000000003',
  'a2000000-0000-0000-0000-000000000002',
  'Crypto-003-新闻', 'researcher', '加密新闻分析师', 'globe', 'idle',
  'b2000000-0000-0000-0000-000000000001',
  'openai_compatible', '{}',
  '{"heartbeat": {"enabled": true, "intervalSec": 0, "wakeOnDemand": true, "maxConcurrentRuns": 1}}',
  500000
);

-- Crypto-004-编辑：报告整合/质量把控
INSERT INTO agents (id, company_id, name, role, title, icon, status, reports_to, adapter_type, adapter_config, runtime_config, budget_monthly_cents)
VALUES (
  'b2000000-0000-0000-0000-000000000004',
  'a2000000-0000-0000-0000-000000000002',
  'Crypto-004-编辑', 'researcher', '研报编辑', 'file-code', 'idle',
  'b2000000-0000-0000-0000-000000000001',
  'openai_compatible', '{}',
  '{"heartbeat": {"enabled": true, "intervalSec": 0, "wakeOnDemand": true, "maxConcurrentRuns": 1}}',
  500000
);

-- ===================== Goals =====================

INSERT INTO goals (id, company_id, title, description, level, status, owner_agent_id)
VALUES
  (
    'c1000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    '统筹管理集团研究院各事业部',
    '作为集团总部，接收董事长指令，统筹协调各事业部高效产出专业研究报告。确保信息流通、质量把控、按时交付。',
    'company', 'active',
    'b1000000-0000-0000-0000-000000000001'
  ),
  (
    'c2000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000002',
    '提供专业的加密市场日度/周度研究报告',
    '覆盖主流加密资产行情分析、链上数据、新闻动态、市场情绪，形成结构化专业研报。',
    'company', 'active',
    'b2000000-0000-0000-0000-000000000001'
  );

-- ===================== Company Memberships (user → companies) =====================
-- Note: userId will be set after Better-Auth creates the user account.
-- For bootstrap, the first login will create the user via Better-Auth.
-- After login, run:
--
-- INSERT INTO instance_user_roles (user_id, role) VALUES ('<user-id>', 'instance_admin');
-- INSERT INTO company_memberships (company_id, principal_type, principal_id, status)
-- VALUES
--   ('a1000000-0000-0000-0000-000000000001', 'user', '<user-id>', 'active'),
--   ('a2000000-0000-0000-0000-000000000002', 'user', '<user-id>', 'active');
--
-- Replace <user-id> with the actual Better-Auth user ID from the `user` table.
