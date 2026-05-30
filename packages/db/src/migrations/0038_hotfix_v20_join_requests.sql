CREATE TABLE "feishu_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"open_id" text NOT NULL,
	"user_name" text,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "feishu_join_requests_open_id_unique_idx" ON "feishu_join_requests" USING btree ("open_id");