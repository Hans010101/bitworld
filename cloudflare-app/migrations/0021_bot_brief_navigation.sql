ALTER TABLE scheduled_tasks ADD COLUMN launch_mode TEXT NOT NULL DEFAULT 'scheduled'
  CHECK (launch_mode IN ('scheduled','bot_navigation'));

UPDATE scheduled_tasks
SET enabled=0,
    launch_mode='bot_navigation',
    updated_at=CURRENT_TIMESTAMP
WHERE id IN (
  'schedule-daily-geopolitics-0900',
  'schedule-daily-finance-1000',
  'schedule-daily-crypto-1700',
  'schedule-daily-justin-sun-sentiment-1700',
  'schedule-daily-tech-2000',
  'schedule-daily-comprehensive-2200'
);

CREATE TABLE bot_navigation_state (
  channel_id TEXT PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  menu_version TEXT NOT NULL,
  synced_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
