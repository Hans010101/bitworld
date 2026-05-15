CREATE TABLE "feishu_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"open_id" text NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feishu_suspensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"open_id" text NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"reason" text,
	"suspended_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feishu_whitelist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"open_id" text NOT NULL,
	"added_by" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "feishu_admins_open_id_unique_idx" ON "feishu_admins" USING btree ("open_id");--> statement-breakpoint
CREATE INDEX "feishu_suspensions_open_id_until_idx" ON "feishu_suspensions" USING btree ("open_id","until");--> statement-breakpoint
CREATE UNIQUE INDEX "feishu_whitelist_open_id_unique_idx" ON "feishu_whitelist" USING btree ("open_id");