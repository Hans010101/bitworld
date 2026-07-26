ALTER TABLE scheduled_tasks ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE scheduled_tasks ADD COLUMN delivery_provider TEXT
  CHECK (delivery_provider IN ('telegram','feishu'));

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user
  ON scheduled_tasks(user_id, enabled, next_run_at);

