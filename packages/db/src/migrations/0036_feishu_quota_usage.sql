CREATE TABLE "feishu_quota_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_open_id" text NOT NULL,
	"day" text NOT NULL,
	"command_count" integer DEFAULT 0 NOT NULL,
	"token_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "feishu_quota_sender_day_unique_idx" ON "feishu_quota_usage" USING btree ("sender_open_id","day");--> statement-breakpoint
CREATE INDEX "feishu_quota_day_idx" ON "feishu_quota_usage" USING btree ("day");