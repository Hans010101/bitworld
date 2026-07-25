CREATE TABLE IF NOT EXISTS company_workflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_message_id TEXT REFERENCES bot_messages(id) ON DELETE SET NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('telegram','feishu','console','schedule')),
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','planning','researching','executing','integrating','delivering','completed','failed')),
  current_stage TEXT NOT NULL DEFAULT 'secretary_intake',
  selected_divisions TEXT NOT NULL DEFAULT '[]',
  ceo_plan TEXT NOT NULL DEFAULT '',
  executive_summary TEXT NOT NULL DEFAULT '',
  final_report TEXT NOT NULL DEFAULT '',
  source_count INTEGER NOT NULL DEFAULT 0,
  source_cutoff_at TEXT,
  pdf_key TEXT,
  download_token_hash TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES company_workflows(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  stage TEXT NOT NULL,
  division TEXT NOT NULL DEFAULT '总部',
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  input TEXT NOT NULL DEFAULT '',
  output TEXT NOT NULL DEFAULT '',
  sources_json TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  provider TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  neurons_used REAL NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workflow_id, sequence)
);

CREATE TABLE IF NOT EXISTS research_sources (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES company_workflows(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES workflow_steps(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  publisher TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  raw_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE reports ADD COLUMN workflow_id TEXT;
ALTER TABLE reports ADD COLUMN pdf_url TEXT;
ALTER TABLE reports ADD COLUMN source_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN source_cutoff_at TEXT;
ALTER TABLE tasks ADD COLUMN company_workflow_id TEXT;

CREATE INDEX IF NOT EXISTS idx_company_workflows_user_created
  ON company_workflows(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_workflows_status
  ON company_workflows(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow
  ON workflow_steps(workflow_id, sequence);
CREATE INDEX IF NOT EXISTS idx_research_sources_workflow
  ON research_sources(workflow_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_workflow
  ON reports(workflow_id);

