-- Commercial multi-tenant boundary.
-- Existing production data belongs to the original owner account; every new
-- business record must carry its own user_id at the application boundary.

ALTER TABLE tasks ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE goals ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE reports ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE approvals ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE runs ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE activity ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;

UPDATE tasks
SET user_id = COALESCE(
  (SELECT user_id FROM company_workflows WHERE company_workflows.id = tasks.company_workflow_id),
  (SELECT id FROM users WHERE role='owner' ORDER BY created_at LIMIT 1)
)
WHERE user_id IS NULL;

UPDATE reports
SET user_id = COALESCE(
  (SELECT user_id FROM company_workflows WHERE company_workflows.id = reports.workflow_id),
  (SELECT tasks.user_id FROM tasks WHERE tasks.id = reports.task_id),
  (SELECT id FROM users WHERE role='owner' ORDER BY created_at LIMIT 1)
)
WHERE user_id IS NULL;

UPDATE runs
SET user_id = COALESCE(
  (SELECT tasks.user_id FROM tasks WHERE tasks.id = runs.task_id),
  (SELECT id FROM users WHERE role='owner' ORDER BY created_at LIMIT 1)
)
WHERE user_id IS NULL;

UPDATE goals
SET user_id = (SELECT id FROM users WHERE role='owner' ORDER BY created_at LIMIT 1)
WHERE user_id IS NULL;

UPDATE approvals
SET user_id = (SELECT id FROM users WHERE role='owner' ORDER BY created_at LIMIT 1)
WHERE user_id IS NULL;

UPDATE activity
SET user_id = (SELECT id FROM users WHERE role='owner' ORDER BY created_at LIMIT 1)
WHERE user_id IS NULL;

UPDATE scheduled_tasks
SET user_id = (SELECT id FROM users WHERE role='owner' ORDER BY created_at LIMIT 1)
WHERE user_id IS NULL;

CREATE TABLE account_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL DEFAULT '我的一人公司',
  timezone TEXT NOT NULL DEFAULT 'Asia/Singapore',
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_completed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO account_settings (user_id,company_name,onboarding_completed)
SELECT id,'BitWorld Company OS',1 FROM users;

CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('run','workflow','bot')),
  source_id TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('deepseek','cloudflare')),
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  neurons_used REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id,source_type,source_id)
);

INSERT OR IGNORE INTO usage_events
  (id,user_id,agent_id,source_type,source_id,model,provider,input_tokens,output_tokens,total_tokens,neurons_used,created_at)
SELECT
  'legacy-run:' || r.id,
  r.user_id,
  r.agent_id,
  'run',
  r.id,
  r.model,
  CASE WHEN r.provider='cloudflare' THEN 'cloudflare' ELSE 'deepseek' END,
  COALESCE(r.input_tokens,0),
  COALESCE(r.output_tokens,0),
  COALESCE(r.total_tokens,0),
  COALESCE(r.neurons_used,0),
  r.created_at
FROM runs r
WHERE r.user_id IS NOT NULL AND r.status='succeeded';

INSERT OR IGNORE INTO usage_events
  (id,user_id,agent_id,source_type,source_id,model,provider,input_tokens,output_tokens,total_tokens,neurons_used,created_at)
SELECT
  'legacy-workflow:' || ws.id,
  cw.user_id,
  ws.agent_id,
  'workflow',
  ws.id,
  COALESCE(ws.model,'unknown'),
  CASE WHEN ws.provider='cloudflare' THEN 'cloudflare' ELSE 'deepseek' END,
  COALESCE(ws.input_tokens,0),
  COALESCE(ws.output_tokens,0),
  COALESCE(ws.total_tokens,0),
  COALESCE(ws.neurons_used,0),
  COALESCE(ws.finished_at,ws.started_at,CURRENT_TIMESTAMP)
FROM workflow_steps ws
JOIN company_workflows cw ON cw.id=ws.workflow_id
WHERE ws.status='completed';

CREATE INDEX idx_tasks_user_status ON tasks(user_id,status,updated_at DESC);
CREATE INDEX idx_goals_user_created ON goals(user_id,created_at DESC);
CREATE INDEX idx_reports_user_created ON reports(user_id,created_at DESC);
CREATE INDEX idx_approvals_user_status ON approvals(user_id,status,created_at DESC);
CREATE INDEX idx_runs_user_created ON runs(user_id,created_at DESC);
CREATE INDEX idx_activity_user_created ON activity(user_id,created_at DESC);
CREATE INDEX idx_schedules_user_due ON scheduled_tasks(user_id,enabled,next_run_at);
CREATE INDEX idx_usage_user_period ON usage_events(user_id,created_at DESC);
CREATE INDEX idx_usage_user_agent_period ON usage_events(user_id,agent_id,created_at DESC);

CREATE TRIGGER tasks_require_user_insert
BEFORE INSERT ON tasks WHEN NEW.user_id IS NULL
BEGIN SELECT RAISE(ABORT,'tasks.user_id is required'); END;
CREATE TRIGGER tasks_require_user_update
BEFORE UPDATE OF user_id ON tasks WHEN NEW.user_id IS NULL
BEGIN SELECT RAISE(ABORT,'tasks.user_id is required'); END;

CREATE TRIGGER goals_require_user_insert
BEFORE INSERT ON goals WHEN NEW.user_id IS NULL
BEGIN SELECT RAISE(ABORT,'goals.user_id is required'); END;
CREATE TRIGGER goals_require_user_update
BEFORE UPDATE OF user_id ON goals WHEN NEW.user_id IS NULL
BEGIN SELECT RAISE(ABORT,'goals.user_id is required'); END;

CREATE TRIGGER reports_require_user_insert
BEFORE INSERT ON reports WHEN NEW.user_id IS NULL
BEGIN SELECT RAISE(ABORT,'reports.user_id is required'); END;
CREATE TRIGGER reports_require_user_update
BEFORE UPDATE OF user_id ON reports WHEN NEW.user_id IS NULL
BEGIN SELECT RAISE(ABORT,'reports.user_id is required'); END;

CREATE TRIGGER approvals_require_user_insert
BEFORE INSERT ON approvals WHEN NEW.user_id IS NULL
BEGIN SELECT RAISE(ABORT,'approvals.user_id is required'); END;
CREATE TRIGGER approvals_require_user_update
BEFORE UPDATE OF user_id ON approvals WHEN NEW.user_id IS NULL
BEGIN SELECT RAISE(ABORT,'approvals.user_id is required'); END;

CREATE TRIGGER runs_require_user_insert
BEFORE INSERT ON runs WHEN NEW.user_id IS NULL
BEGIN SELECT RAISE(ABORT,'runs.user_id is required'); END;
CREATE TRIGGER runs_require_user_update
BEFORE UPDATE OF user_id ON runs WHEN NEW.user_id IS NULL
BEGIN SELECT RAISE(ABORT,'runs.user_id is required'); END;

CREATE TRIGGER activity_require_user_insert
BEFORE INSERT ON activity WHEN NEW.user_id IS NULL
BEGIN SELECT RAISE(ABORT,'activity.user_id is required'); END;
CREATE TRIGGER activity_require_user_update
BEFORE UPDATE OF user_id ON activity WHEN NEW.user_id IS NULL
BEGIN SELECT RAISE(ABORT,'activity.user_id is required'); END;

CREATE TRIGGER schedules_require_user_insert
BEFORE INSERT ON scheduled_tasks WHEN NEW.user_id IS NULL
BEGIN SELECT RAISE(ABORT,'scheduled_tasks.user_id is required'); END;
CREATE TRIGGER schedules_require_user_update
BEFORE UPDATE OF user_id ON scheduled_tasks WHEN NEW.user_id IS NULL
BEGIN SELECT RAISE(ABORT,'scheduled_tasks.user_id is required'); END;
