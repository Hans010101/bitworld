CREATE TABLE IF NOT EXISTS scheduled_task_channels (
  schedule_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('telegram','feishu')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (schedule_id, provider)
);

INSERT OR IGNORE INTO scheduled_task_channels (schedule_id, provider)
SELECT id, delivery_provider
FROM scheduled_tasks
WHERE delivery_provider IN ('telegram','feishu');

CREATE INDEX IF NOT EXISTS idx_scheduled_task_channels_provider
  ON scheduled_task_channels(provider, schedule_id);

CREATE TABLE IF NOT EXISTS company_workflow_delivery_targets (
  workflow_id TEXT NOT NULL REFERENCES company_workflows(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('telegram','feishu')),
  external_message_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  summary_delivered_at TEXT,
  document_delivered_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workflow_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_delivery_targets_pending
  ON company_workflow_delivery_targets(workflow_id, summary_delivered_at, document_delivered_at);
