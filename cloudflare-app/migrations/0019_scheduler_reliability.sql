CREATE TABLE IF NOT EXISTS scheduler_state (
  id TEXT PRIMARY KEY,
  last_started_at TEXT,
  last_completed_at TEXT,
  last_source TEXT,
  last_dispatched_count INTEGER NOT NULL DEFAULT 0,
  last_recovered_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO scheduler_state (id) VALUES ('global');

CREATE TABLE IF NOT EXISTS scheduled_task_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed','dispatched','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  workflow_id TEXT REFERENCES company_workflows(id) ON DELETE SET NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at TEXT,
  UNIQUE(schedule_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_user_created
  ON scheduled_task_runs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_status
  ON scheduled_task_runs(status, updated_at);
