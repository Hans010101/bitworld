CREATE TABLE IF NOT EXISTS report_artifacts (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES company_workflows(id) ON DELETE CASCADE,
  body BLOB NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/pdf',
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_report_artifacts_workflow
  ON report_artifacts(workflow_id);

