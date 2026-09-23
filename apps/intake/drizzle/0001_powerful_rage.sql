CREATE TYPE "public"."notice_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
ALTER TYPE "public"."lead_status" ADD VALUE 'documents_received' BEFORE 'failed';--> statement-breakpoint
CREATE TABLE "outcome_notices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"status" "notice_status" NOT NULL,
	"subject" text,
	"body" text,
	"email_message_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "outcome_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "figure_decisions_lead_id_key";--> statement-breakpoint
ALTER TABLE "chases" ADD COLUMN "reply_to" text;--> statement-breakpoint
ALTER TABLE "chases" ADD COLUMN "reply" jsonb;--> statement-breakpoint
ALTER TABLE "figure_decisions" ADD COLUMN "kind" text DEFAULT 'soft_pull' NOT NULL;--> statement-breakpoint
ALTER TABLE "outcome_notices" ADD CONSTRAINT "outcome_notices_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outcome_notices_lead_id_key" ON "outcome_notices" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "figure_decisions_lead_id_kind_key" ON "figure_decisions" USING btree ("lead_id","kind");