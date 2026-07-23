ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'direct' CHECK (source IN ('direct','secretary','schedule'));
ALTER TABLE tasks ADD COLUMN workflow_stage TEXT NOT NULL DEFAULT 'division_execution' CHECK (workflow_stage IN ('secretary_intake','division_execution','division_review','secretary_synthesis','board_decision','archived'));
ALTER TABLE tasks ADD COLUMN requested_by TEXT NOT NULL DEFAULT '你';
ALTER TABLE tasks ADD COLUMN output_requirements TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN final_report_id TEXT;

ALTER TABLE agents ADD COLUMN system_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN temperature REAL NOT NULL DEFAULT 0.3;
ALTER TABLE agents ADD COLUMN reasoning_mode TEXT NOT NULL DEFAULT 'auto' CHECK (reasoning_mode IN ('auto','high','off'));
ALTER TABLE agents ADD COLUMN max_output_tokens INTEGER NOT NULL DEFAULT 3000;
ALTER TABLE agents ADD COLUMN execution_timeout_sec INTEGER NOT NULL DEFAULT 120;
ALTER TABLE agents ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 2;
ALTER TABLE agents ADD COLUMN tool_policy TEXT NOT NULL DEFAULT 'standard' CHECK (tool_policy IN ('readonly','standard','elevated'));
ALTER TABLE agents ADD COLUMN memory_policy TEXT NOT NULL DEFAULT 'task' CHECK (memory_policy IN ('none','task','division'));

ALTER TABLE reports ADD COLUMN task_id TEXT;
ALTER TABLE reports ADD COLUMN division TEXT NOT NULL DEFAULT '总部';
ALTER TABLE reports ADD COLUMN decision_status TEXT NOT NULL DEFAULT 'informational' CHECK (decision_status IN ('informational','needs_decision','approved','rejected','archived'));
ALTER TABLE reports ADD COLUMN confidence TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low','medium','high'));
ALTER TABLE reports ADD COLUMN recommendation TEXT NOT NULL DEFAULT '';

CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  division TEXT NOT NULL DEFAULT '总部',
  assignee_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('hourly','daily','weekdays','weekly','monthly')),
  time_utc TEXT NOT NULL DEFAULT '01:00',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent','high','medium','low')),
  output_requirements TEXT NOT NULL DEFAULT '',
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_scheduled_tasks_due ON scheduled_tasks(enabled, next_run_at);
CREATE INDEX idx_tasks_workflow ON tasks(workflow_stage, updated_at DESC);
CREATE INDEX idx_reports_decision ON reports(decision_status, created_at DESC);

UPDATE tasks SET
  source = 'secretary',
  requested_by = 'HQ-003-董秘',
  output_requirements = '输出结论、关键依据、主要风险、行动建议及需总部决策事项',
  workflow_stage = CASE
    WHEN status = 'in_review' THEN 'secretary_synthesis'
    WHEN status = 'done' THEN 'archived'
    ELSE 'division_execution'
  END;

UPDATE reports SET division = COALESCE((SELECT division FROM agents WHERE agents.name = reports.author LIMIT 1), '总部'),
  recommendation = summary,
  confidence = 'medium';

INSERT INTO scheduled_tasks (id,title,description,division,assignee_agent_id,frequency,time_utc,enabled,priority,output_requirements,next_run_at) VALUES
('schedule-daily-intel','每日行业情报简报','扫描重要行业信号，过滤重复信息，并说明对公司经营的影响。','新闻','news-001','daily','01:00',1,'medium','5 条高信号情报；每条包含事实、影响、建议动作；标明信息时间',datetime(date('now','+1 day') || ' 01:00:00')),
('schedule-weekly-risk','每周经营风险复盘','汇总本周事业部风险、依赖和需要总部介入的问题。','总部','hq-003','weekly','02:00',1,'high','按红黄绿分级；列出责任事业部、处置建议和需董事会决策事项',datetime(date('now','+7 days') || ' 02:00:00'));
