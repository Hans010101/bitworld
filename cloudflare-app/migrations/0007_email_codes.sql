PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS email_auth_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login','register')),
  display_name TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_auth_codes_lookup
  ON email_auth_codes(email, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_auth_codes_expiry
  ON email_auth_codes(expires_at);
