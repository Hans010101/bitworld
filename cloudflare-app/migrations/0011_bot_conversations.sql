CREATE TABLE IF NOT EXISTS bot_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('telegram','feishu')),
  external_message_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  sender_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed')),
  model TEXT,
  model_provider TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel_id, external_message_id, role)
);

CREATE INDEX IF NOT EXISTS idx_bot_messages_conversation
  ON bot_messages(channel_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_messages_status
  ON bot_messages(status, created_at);
