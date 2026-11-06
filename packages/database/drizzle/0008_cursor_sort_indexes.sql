DROP INDEX "builder"."forms_workspace_page_idx";--> statement-breakpoint
DROP INDEX "builder"."submissions_page_idx";--> statement-breakpoint
DROP INDEX "builder"."submissions_completed_idx";--> statement-breakpoint
DROP INDEX "builder"."audit_page_idx";--> statement-breakpoint
CREATE INDEX "forms_workspace_page_idx" ON "builder"."forms" USING btree ("workspace_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "builder"."forms"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "submissions_page_idx" ON "builder"."form_submissions" USING btree ("workspace_id","form_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "builder"."form_submissions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "submissions_completed_idx" ON "builder"."form_submissions" USING btree ("workspace_id","form_id","completed_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "builder"."form_submissions"."deleted_at" IS NULL AND "builder"."form_submissions"."status" = 'COMPLETED';--> statement-breakpoint
CREATE INDEX "audit_page_idx" ON "builder"."workspace_audit_events" USING btree ("workspace_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);