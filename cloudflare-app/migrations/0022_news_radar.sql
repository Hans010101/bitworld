CREATE TABLE news_radar_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  score_threshold INTEGER NOT NULL DEFAULT 7 CHECK (score_threshold BETWEEN 1 AND 10),
  max_items INTEGER NOT NULL DEFAULT 12 CHECK (max_items BETWEEN 5 AND 20),
  duplicate_window_hours INTEGER NOT NULL DEFAULT 36 CHECK (duplicate_window_hours BETWEEN 24 AND 168),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO news_radar_profiles (user_id)
SELECT id FROM users;

CREATE TABLE news_radar_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  publisher TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  score INTEGER CHECK (score BETWEEN 1 AND 10),
  rationale TEXT NOT NULL DEFAULT '',
  selected_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, fingerprint)
);

CREATE INDEX idx_news_radar_items_user_selected
  ON news_radar_items(user_id, selected_at DESC);

CREATE INDEX idx_news_radar_items_user_seen
  ON news_radar_items(user_id, last_seen_at DESC);

INSERT OR IGNORE INTO scheduled_tasks
  (id,user_id,delivery_provider,title,description,division,assignee_agent_id,frequency,time_utc,enabled,priority,output_requirements,next_run_at,launch_mode)
SELECT
  'schedule-daily-finance-radar-0800',
  id,
  'telegram',
  'BitWorld 财经新闻雷达',
  '扫描过去24小时全球高价值财经信息，由新闻雷达跨期去重并按决策价值排序，只保留值得持续关注的新信号。',
  '新闻',
  'news-001',
  'daily',
  '00:00',
  1,
  'high',
  '中文核心摘要与PDF完整报告；精选8至12条高信号事件；说明事实、重要性、潜在影响及下一观察点；参考资料只保留标题、链接和发布时间。',
  CASE WHEN time('now')<'00:00:00'
    THEN datetime(date('now') || ' 00:00:00')
    ELSE datetime(date('now','+1 day') || ' 00:00:00')
  END,
  'scheduled'
FROM users
ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at
LIMIT 1;

INSERT OR IGNORE INTO scheduled_task_channels (schedule_id,provider)
SELECT id,'telegram' FROM scheduled_tasks WHERE id='schedule-daily-finance-radar-0800'
UNION ALL
SELECT id,'feishu' FROM scheduled_tasks WHERE id='schedule-daily-finance-radar-0800';
