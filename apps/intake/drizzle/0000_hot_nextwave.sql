CREATE TYPE "public"."chase_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('submitted', 'processing', 'approved', 'rejected', 'need_more_documents', 'chase_sent', 'failed');--> statement-breakpoint
CREATE TABLE "chases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"status" "chase_status" NOT NULL,
	"subject" text,
	"body" text,
	"email_message_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "figure_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"status" text NOT NULL,
	"decision" jsonb NOT NULL,
	"raw_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "figure_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "lead_events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"lead_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"property_state" text NOT NULL,
	"estimated_home_value" numeric(12, 2) NOT NULL,
	"mortgage_balance" numeric(12, 2) NOT NULL,
	"credit_band" text NOT NULL,
	"income_band" text NOT NULL,
	"purpose" text NOT NULL,
	"status" "lead_status" NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chases" ADD CONSTRAINT "chases_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "figure_decisions" ADD CONSTRAINT "figure_decisions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chases_lead_id_key" ON "chases" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "figure_decisions_lead_id_key" ON "figure_decisions" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_events_lead_id_sequence_idx" ON "lead_events" USING btree ("lead_id","sequence");