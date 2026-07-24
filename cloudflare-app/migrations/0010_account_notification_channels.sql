PRAGMA defer_foreign_keys = ON;

CREATE TABLE notification_channels_v2 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('telegram','feishu','wecom')),
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  events TEXT NOT NULL DEFAULT '[]',
  config_ciphertext TEXT NOT NULL,
  last_test_at TEXT,
  last_test_status TEXT CHECK (last_test_status IN ('success','failed')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, provider)
);

INSERT INTO notification_channels_v2 (
  id,user_id,provider,name,enabled,events,config_ciphertext,last_test_at,last_test_status,last_error,created_at,updated_at
)
SELECT
  c.id,
  COALESCE(
    (SELECT id FROM users WHERE lower(email)='hans.pan007@gmail.com' LIMIT 1),
    (SELECT id FROM users WHERE role='owner' ORDER BY created_at LIMIT 1),
    (SELECT id FROM users ORDER BY created_at LIMIT 1)
  ),
  c.provider,c.name,c.enabled,c.events,c.config_ciphertext,c.last_test_at,c.last_test_status,c.last_error,c.created_at,c.updated_at
FROM notification_channels c;

CREATE TABLE notification_deliveries_v2 (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES notification_channels_v2(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success','failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO notification_deliveries_v2 (id,channel_id,event_type,title,status,error,created_at)
SELECT id,channel_id,event_type,title,status,error,created_at
FROM notification_deliveries;

DROP TABLE notification_deliveries;
DROP TABLE notification_channels;

ALTER TABLE notification_channels_v2 RENAME TO notification_channels;
ALTER TABLE notification_deliveries_v2 RENAME TO notification_deliveries;

CREATE UNIQUE INDEX idx_notification_channels_user_provider
  ON notification_channels(user_id, provider);

CREATE INDEX idx_notification_deliveries_created
  ON notification_deliveries(created_at DESC);

CREATE INDEX idx_notification_deliveries_channel
  ON notification_deliveries(channel_id, created_at DESC);
