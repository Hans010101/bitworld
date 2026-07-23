CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE CHECK (provider IN ('telegram','feishu','wecom')),
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  events TEXT NOT NULL DEFAULT '[]',
  config_ciphertext TEXT NOT NULL,
  last_test_at TEXT,
  last_test_status TEXT CHECK (last_test_status IN ('success','failed')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success','failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_created
  ON notification_deliveries(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_channel
  ON notification_deliveries(channel_id, created_at DESC);
