CREATE TABLE "session_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid,
	"task_type" text,
	"completed" jsonb,
	"discoveries" jsonb,
	"next_attention" jsonb,
	"issues_found" jsonb,
	"quality_score" integer,
	"quality_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "session_memories" ADD CONSTRAINT "session_memories_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_memories" ADD CONSTRAINT "session_memories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_memories" ADD CONSTRAINT "session_memories_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_memories_agent_idx" ON "session_memories" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "session_memories_company_idx" ON "session_memories" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "session_memories_agent_created_at_idx" ON "session_memories" USING btree ("agent_id","created_at");