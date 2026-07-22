PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  role TEXT NOT NULL,
  division TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','working','paused','error')),
  model TEXT NOT NULL DEFAULT 'deepseek-v3',
  current_task TEXT,
  monthly_budget REAL NOT NULL DEFAULT 0,
  monthly_spend REAL NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('backlog','todo','in_progress','in_review','done','blocked')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent','high','medium','low')),
  division TEXT NOT NULL DEFAULT '总部',
  assignee_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  due_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  metric TEXT NOT NULL,
  current_value REAL NOT NULL DEFAULT 0,
  target_value REAL NOT NULL DEFAULT 100,
  owner TEXT NOT NULL,
  horizon TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  author TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  risk TEXT NOT NULL DEFAULT 'medium' CHECK (risk IN ('low','medium','high')),
  requested_by TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  model TEXT NOT NULL,
  output_excerpt TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_agent_id);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_ip_time ON auth_attempts(ip_hash, attempted_at DESC);

INSERT OR IGNORE INTO agents (id,name,title,role,division,status,model,current_task,monthly_budget,monthly_spend,last_seen_at) VALUES
('hq-001','HQ-001-CEO','集团首席执行官','ceo','总部','working','qwen3-max','制定 Q3 经营优先级',80,18.42,datetime('now','-8 minutes')),
('hq-002','HQ-002-CTO','首席技术官','cto','总部','active','deepseek-r1',NULL,55,7.28,datetime('now','-22 minutes')),
('hq-003','HQ-003-董秘','董事会秘书','secretary','总部','active','deepseek-v3','整理今日公司简报',28,4.11,datetime('now','-12 minutes')),
('hq-004','HQ-004-CHO','首席人才官','cho','总部','active','deepseek-v3',NULL,24,2.37,datetime('now','-3 hours')),
('hq-005','HQ-005-CFO','首席财务官','cfo','总部','active','deepseek-v3','复核模型预算',26,5.16,datetime('now','-41 minutes')),
('news-001','News-001-CEO','新闻事业部负责人','division_ceo','新闻','working','deepseek-v3','生成晚间科技情报',42,12.63,datetime('now','-5 minutes')),
('news-002','News-002-采集','新闻采集员','collector','新闻','active','deepseek-v3',NULL,18,3.92,datetime('now','-28 minutes')),
('news-003','News-003-分析','新闻分析师','analyst','新闻','active','deepseek-v3',NULL,22,4.48,datetime('now','-1 hours')),
('news-004','News-004-简报','新闻简报编辑','editor','新闻','active','deepseek-v3',NULL,18,2.86,datetime('now','-2 hours')),
('news-005','News-005-编译','技术信息编译员','translator','新闻','paused','deepseek-v3',NULL,16,1.14,datetime('now','-1 days')),
('sentiment-001','Sentiment-001-CEO','舆情事业部负责人','division_ceo','舆情','active','deepseek-v3',NULL,36,8.72,datetime('now','-18 minutes')),
('sentiment-002','Sentiment-002-采集','舆情采集员','collector','舆情','active','deepseek-v3',NULL,16,2.91,datetime('now','-44 minutes')),
('sentiment-003','Sentiment-003-分析','舆情分析师','analyst','舆情','active','deepseek-v3',NULL,21,3.78,datetime('now','-2 hours')),
('sentiment-004','Sentiment-004-报告','舆情报告员','reporter','舆情','active','deepseek-v3',NULL,16,2.12,datetime('now','-3 hours')),
('crypto-001','Crypto-001-CEO','加密事业部负责人','division_ceo','加密','working','qwen3-max','评估 BTC 周期风险',48,15.33,datetime('now','-7 minutes')),
('crypto-002','Crypto-002-数据','链上数据分析员','data','加密','active','qwen3-max',NULL,28,5.86,datetime('now','-33 minutes')),
('crypto-003','Crypto-003-策略','加密策略分析师','strategist','加密','active','qwen3-max',NULL,32,7.41,datetime('now','-1 hours')),
('crypto-004','Crypto-004-风控','风险控制员','risk','加密','active','deepseek-r1',NULL,30,6.08,datetime('now','-55 minutes')),
('crypto-005','Crypto-005-开发','策略开发员','developer','加密','paused','qwen3-max',NULL,24,3.28,datetime('now','-2 days')),
('research-001','Research-001-CEO','研究事业部负责人','division_ceo','研究','active','qwen3-max','规划本周深度研究',50,13.97,datetime('now','-16 minutes')),
('research-002','Research-002-主编','研究主编','editor','研究','active','deepseek-v3',NULL,25,4.77,datetime('now','-38 minutes')),
('research-003','Research-003-写手','研究报告撰写员','writer','研究','active','deepseek-v3',NULL,24,4.26,datetime('now','-1 hours')),
('research-004','Research-004-数据','研究数据分析员','data','研究','active','qwen3-max',NULL,28,6.31,datetime('now','-2 hours'));

INSERT OR IGNORE INTO tasks (id,title,description,status,priority,division,assignee_agent_id,due_at,created_at,updated_at) VALUES
('task-q3-plan','确认 Q3 一人公司经营主线','从现有能力中只选择一条可变现主线，明确目标客户、价值主张和 30 天验证指标。','in_review','urgent','总部','hq-001',datetime('now','+1 day'),datetime('now','-2 days'),datetime('now','-20 minutes')),
('task-cf-launch','完成 Cloudflare 控制台迁移','验收新的 Workers、D1、Queue 与安全登录，确认移动端可用。','in_progress','high','总部','hq-002',datetime('now','+2 days'),datetime('now','-1 day'),datetime('now','-12 minutes')),
('task-ai-brief','输出 AI 产品机会晚报','筛选 5 条真正影响独立开发者与小企业的产品机会，给出证据和行动建议。','in_progress','medium','新闻','news-001',datetime('now','+8 hours'),datetime('now','-6 hours'),datetime('now','-5 minutes')),
('task-budget','建立模型成本红线','将月度预算拆到事业部和 Agent，定义 80% 提醒和 100% 暂停规则。','todo','high','总部','hq-005',datetime('now','+3 days'),datetime('now','-10 hours'),datetime('now','-41 minutes')),
('task-crypto-risk','复核 BTC 周期风险','综合价格结构、链上数据与市场情绪，形成不超过 800 字的风险备忘。','todo','medium','加密','crypto-001',datetime('now','+1 day'),datetime('now','-4 hours'),datetime('now','-1 hours')),
('task-user-interview','设计首批用户访谈提纲','围绕真实工作流、支付意愿与现有替代方案设计 10 个开放问题。','todo','medium','研究','research-001',datetime('now','+4 days'),datetime('now','-1 day'),datetime('now','-2 hours')),
('task-webhook-security','关闭旧 webhook 安全风险','轮换旧密钥并停止未验签的 Telegram 与飞书入口。','blocked','urgent','总部','hq-002',datetime('now','+1 day'),datetime('now','-2 days'),datetime('now','-35 minutes')),
('task-market-map','完成 AI Agent 控制台竞品地图','比较 8 个同类产品的定位、价格、核心功能与分发路径。','done','medium','研究','research-002',datetime('now','-1 day'),datetime('now','-5 days'),datetime('now','-1 day'));

INSERT OR IGNORE INTO goals (id,title,description,status,progress,metric,current_value,target_value,owner,horizon) VALUES
('goal-relaunch','完成 BitWorld 安全重启','建立稳定、可访问、可持续迭代的公司控制台。','active',72,'关键里程碑',5,7,'HQ-002-CTO','Q3'),
('goal-revenue','验证第一条可变现业务线','通过真实用户访谈和付费试点验证，而不是以功能数量判断进展。','active',35,'付费试点',1,3,'HQ-001-CEO','Q3'),
('goal-intel','建立高信噪比情报机制','每日输出可行动的行业信号，减少重复阅读和信息焦虑。','active',64,'有效决策输入',16,25,'News-001-CEO','本月'),
('goal-cost','模型成本保持在经营预算内','确保自动化收益大于模型和基础设施投入。','active',84,'预算健康度',84,100,'HQ-005-CFO','本月');

INSERT OR IGNORE INTO reports (id,title,type,summary,content,status,author,created_at) VALUES
('report-relaunch','BitWorld 重启评估与迁移建议','战略备忘','项目具备扎实基础，但恢复公网前必须先修安全与运维。','## 核心判断\nBitWorld 适合作为一人公司的内部经营控制台，而不是直接公开的多租户 SaaS。\n\n## 迁移原则\n保留成熟的组织、任务和治理思想；放弃常驻进程、失效数据库与未验签 webhook。\n\n## 下一步\n先让新的 Cloudflare 控制台稳定运行，再按经营价值逐步迁移自动化。','published','HQ-001-CEO',datetime('now','-3 hours')),
('report-ai-opportunity','AI 原生小企业工具机会扫描','市场情报','最值得验证的方向集中在高频、强结果导向的垂直工作流。','## 今日信号\n小企业对通用 Agent 的兴趣下降，对可直接交付结果的专用工具兴趣上升。\n\n## 建议动作\n选择一个拥有明确输入、输出和验收标准的工作流，先做 3 个付费试点。','published','News-001-CEO',datetime('now','-8 hours')),
('report-budget','模型成本结构周报','财务简报','当前预算健康，但高能力模型应只用于高价值判断。','## 本周概览\n总成本处于预算内，研究与加密事业部占比最高。\n\n## 优化建议\n采集、翻译和格式化任务优先使用低成本模型；复杂推理保留给 CEO 与风控角色。','published','HQ-005-CFO',datetime('now','-1 day'));

INSERT OR IGNORE INTO approvals (id,title,type,status,risk,requested_by,rationale,created_at) VALUES
('approval-model-budget','将 Research-001 单次任务上限提高到 $3','budget_change','pending','medium','HQ-005-CFO','深度研究任务需要更长上下文，但应仅限指定任务并记录产出。',datetime('now','-2 hours')),
('approval-external-channel','恢复外部飞书指令入口','security_change','pending','high','HQ-001-CEO','只有在完成事件签名、重放保护与额度限制后才能恢复。',datetime('now','-5 hours')),
('approval-cloudflare','采用 Cloudflare 原生控制台架构','architecture','approved','medium','HQ-002-CTO','降低常驻服务器成本，并将状态、异步执行和静态资源拆分。',datetime('now','-1 day'));

INSERT OR IGNORE INTO activity (id,type,summary,actor,created_at) VALUES
('activity-1','deployment','Cloudflare 原生控制台进入部署阶段','HQ-002-CTO',datetime('now','-12 minutes')),
('activity-2','task','AI 产品机会晚报开始执行','News-001-CEO',datetime('now','-31 minutes')),
('activity-3','budget','完成本月 Agent 预算复核','HQ-005-CFO',datetime('now','-1 hours')),
('activity-4','report','发布 BitWorld 重启评估与迁移建议','HQ-001-CEO',datetime('now','-3 hours')),
('activity-5','security','旧 Cloud Run 服务已确认离线','HQ-002-CTO',datetime('now','-6 hours'));
