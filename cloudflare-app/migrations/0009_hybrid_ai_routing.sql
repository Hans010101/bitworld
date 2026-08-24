ALTER TABLE agents ADD COLUMN monthly_neurons_used REAL NOT NULL DEFAULT 0;

ALTER TABLE runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'pending' CHECK (provider IN ('pending','deepseek','cloudflare'));
ALTER TABLE runs ADD COLUMN neurons_used REAL NOT NULL DEFAULT 0;

CREATE TABLE ai_routing_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  prefer_cloudflare_free INTEGER NOT NULL DEFAULT 1 CHECK (prefer_cloudflare_free IN (0,1)),
  cloudflare_model TEXT NOT NULL DEFAULT '@cf/zai-org/glm-4.7-flash',
  daily_neuron_allocation INTEGER NOT NULL DEFAULT 10000,
  daily_neuron_soft_limit INTEGER NOT NULL DEFAULT 9500,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO ai_routing_settings (
  id,
  prefer_cloudflare_free,
  cloudflare_model,
  daily_neuron_allocation,
  daily_neuron_soft_limit
) VALUES ('default', 1, '@cf/zai-org/glm-4.7-flash', 10000, 9500);

UPDATE runs
SET provider = CASE WHEN model LIKE 'workers-ai/%' THEN 'cloudflare' ELSE 'deepseek' END
WHERE status IN ('succeeded','failed');

CREATE INDEX idx_runs_provider_created ON runs(provider, created_at DESC);
