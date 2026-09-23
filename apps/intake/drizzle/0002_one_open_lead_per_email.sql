ALTER TABLE "leads" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_idempotency_key_key" ON "leads" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "leads_email_created_at_idx" ON "leads" USING btree (lower("email"),"created_at");