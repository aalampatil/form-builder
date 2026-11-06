CREATE TABLE "builder"."answer_files" (
	"workspace_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	CONSTRAINT "answer_files_answer_id_file_id_pk" PRIMARY KEY("answer_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "builder"."answer_selections" (
	"workspace_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	CONSTRAINT "answer_selections_answer_id_option_id_pk" PRIMARY KEY("answer_id","option_id")
);
--> statement-breakpoint
CREATE TABLE "builder"."form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"respondent_user_id" uuid,
	"status" text DEFAULT 'IN_PROGRESS' NOT NULL,
	"idempotency_key" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_scope_unique" UNIQUE("workspace_id","version_id","id"),
	CONSTRAINT "submissions_status_check" CHECK (("builder"."form_submissions"."status" = 'COMPLETED' AND "builder"."form_submissions"."completed_at" IS NOT NULL AND "builder"."form_submissions"."completed_at" >= "builder"."form_submissions"."started_at") OR ("builder"."form_submissions"."status" IN ('IN_PROGRESS','ABANDONED') AND "builder"."form_submissions"."completed_at" IS NULL)),
	CONSTRAINT "submissions_expiry_check" CHECK ("builder"."form_submissions"."expires_at" IS NULL OR "builder"."form_submissions"."expires_at" >= "builder"."form_submissions"."started_at"),
	CONSTRAINT "submissions_metadata_check" CHECK (jsonb_typeof("builder"."form_submissions"."metadata") = 'object'),
	CONSTRAINT "submissions_idempotency_check" CHECK ("builder"."form_submissions"."idempotency_key" IS NULL OR length("builder"."form_submissions"."idempotency_key") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "builder"."submission_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"storage_kind" text NOT NULL,
	"value_text" text,
	"value_number" numeric,
	"value_boolean" boolean,
	"value_date" date,
	"value_datetime" timestamp with time zone,
	"value_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answers_field_unique" UNIQUE("workspace_id","submission_id","field_id"),
	CONSTRAINT "answers_field_scope_unique" UNIQUE("workspace_id","version_id","id","field_id"),
	CONSTRAINT "answers_submission_scope_unique" UNIQUE("workspace_id","version_id","submission_id","id"),
	CONSTRAINT "answers_payload_check" CHECK ((
    ("builder"."submission_answers"."storage_kind" = 'TEXT' AND "builder"."submission_answers"."value_text" IS NOT NULL) OR
    ("builder"."submission_answers"."storage_kind" = 'NUMBER' AND "builder"."submission_answers"."value_number" IS NOT NULL AND "builder"."submission_answers"."value_number" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) OR
    ("builder"."submission_answers"."storage_kind" = 'BOOLEAN' AND "builder"."submission_answers"."value_boolean" IS NOT NULL) OR
    ("builder"."submission_answers"."storage_kind" = 'DATE' AND "builder"."submission_answers"."value_date" IS NOT NULL AND isfinite("builder"."submission_answers"."value_date")) OR
    ("builder"."submission_answers"."storage_kind" = 'DATETIME' AND "builder"."submission_answers"."value_datetime" IS NOT NULL AND isfinite("builder"."submission_answers"."value_datetime")) OR
    ("builder"."submission_answers"."storage_kind" = 'JSON' AND "builder"."submission_answers"."value_json" IS NOT NULL AND "builder"."submission_answers"."value_json" <> 'null'::jsonb) OR
    "builder"."submission_answers"."storage_kind" IN ('SINGLE_SELECT','MULTI_SELECT','FILE')
  ) AND num_nonnulls("builder"."submission_answers"."value_text", "builder"."submission_answers"."value_number", "builder"."submission_answers"."value_boolean", "builder"."submission_answers"."value_date", "builder"."submission_answers"."value_datetime", "builder"."submission_answers"."value_json") = CASE WHEN "builder"."submission_answers"."storage_kind" IN ('SINGLE_SELECT','MULTI_SELECT','FILE') THEN 0 ELSE 1 END)
);
--> statement-breakpoint
CREATE TABLE "builder"."submission_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_count" bigint NOT NULL,
	"checksum" text,
	"upload_state" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_files_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "files_scope_unique" UNIQUE("workspace_id","version_id","submission_id","id"),
	CONSTRAINT "files_size_check" CHECK ("builder"."submission_files"."byte_count" >= 0),
	CONSTRAINT "files_state_check" CHECK ("builder"."submission_files"."upload_state" IN ('PENDING','READY','REJECTED')),
	CONSTRAINT "files_metadata_check" CHECK (length(btrim("builder"."submission_files"."object_key")) > 0 AND length(btrim("builder"."submission_files"."original_filename")) > 0 AND length(btrim("builder"."submission_files"."media_type")) > 0)
);
--> statement-breakpoint
CREATE TABLE "builder"."workspace_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_metadata_check" CHECK (jsonb_typeof("builder"."workspace_audit_events"."metadata") = 'object' AND octet_length("builder"."workspace_audit_events"."metadata"::text) <= 8192),
	CONSTRAINT "audit_action_check" CHECK (length(btrim("builder"."workspace_audit_events"."action")) > 0 AND length(btrim("builder"."workspace_audit_events"."entity_type")) > 0)
);
--> statement-breakpoint
ALTER TABLE "builder"."answer_files" ADD CONSTRAINT "attachments_answer_fk" FOREIGN KEY ("workspace_id","version_id","submission_id","answer_id") REFERENCES "builder"."submission_answers"("workspace_id","version_id","submission_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."answer_files" ADD CONSTRAINT "attachments_file_fk" FOREIGN KEY ("workspace_id","version_id","submission_id","file_id") REFERENCES "builder"."submission_files"("workspace_id","version_id","submission_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."answer_selections" ADD CONSTRAINT "selections_answer_fk" FOREIGN KEY ("workspace_id","version_id","answer_id","field_id") REFERENCES "builder"."submission_answers"("workspace_id","version_id","id","field_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."answer_selections" ADD CONSTRAINT "selections_option_fk" FOREIGN KEY ("workspace_id","version_id","field_id","option_id") REFERENCES "builder"."field_options"("workspace_id","version_id","field_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."form_submissions" ADD CONSTRAINT "form_submissions_respondent_user_id_users_id_fk" FOREIGN KEY ("respondent_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."form_submissions" ADD CONSTRAINT "submissions_version_fk" FOREIGN KEY ("workspace_id","form_id","version_id") REFERENCES "builder"."form_versions"("workspace_id","form_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."submission_answers" ADD CONSTRAINT "answers_submission_fk" FOREIGN KEY ("workspace_id","version_id","submission_id") REFERENCES "builder"."form_submissions"("workspace_id","version_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."submission_answers" ADD CONSTRAINT "answers_field_fk" FOREIGN KEY ("workspace_id","version_id","field_id") REFERENCES "builder"."form_fields"("workspace_id","version_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."submission_files" ADD CONSTRAINT "files_submission_fk" FOREIGN KEY ("workspace_id","version_id","submission_id") REFERENCES "builder"."form_submissions"("workspace_id","version_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."workspace_audit_events" ADD CONSTRAINT "workspace_audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "builder"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."workspace_audit_events" ADD CONSTRAINT "workspace_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_file_idx" ON "builder"."answer_files" USING btree ("workspace_id","version_id","submission_id","file_id");--> statement-breakpoint
CREATE INDEX "selections_option_idx" ON "builder"."answer_selections" USING btree ("workspace_id","version_id","field_id","option_id");--> statement-breakpoint
CREATE INDEX "selections_analytics_idx" ON "builder"."answer_selections" USING btree ("workspace_id","option_id","answer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_idempotency_unique" ON "builder"."form_submissions" USING btree ("workspace_id","form_id","idempotency_key") WHERE "builder"."form_submissions"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "submissions_page_idx" ON "builder"."form_submissions" USING btree ("workspace_id","form_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "builder"."form_submissions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "submissions_completed_idx" ON "builder"."form_submissions" USING btree ("workspace_id","form_id","completed_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "builder"."form_submissions"."deleted_at" IS NULL AND "builder"."form_submissions"."status" = 'COMPLETED';--> statement-breakpoint
CREATE INDEX "submissions_version_idx" ON "builder"."form_submissions" USING btree ("workspace_id","version_id");--> statement-breakpoint
CREATE INDEX "submissions_respondent_idx" ON "builder"."form_submissions" USING btree ("respondent_user_id");--> statement-breakpoint
CREATE INDEX "submissions_expiry_idx" ON "builder"."form_submissions" USING btree ("expires_at","id") WHERE "builder"."form_submissions"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "answers_field_idx" ON "builder"."submission_answers" USING btree ("workspace_id","version_id","field_id");--> statement-breakpoint
CREATE INDEX "answers_numeric_idx" ON "builder"."submission_answers" USING btree ("workspace_id","field_id","value_number","submission_id") WHERE "builder"."submission_answers"."value_number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "answers_date_idx" ON "builder"."submission_answers" USING btree ("workspace_id","field_id","value_date","submission_id") WHERE "builder"."submission_answers"."value_date" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "files_submission_idx" ON "builder"."submission_files" USING btree ("workspace_id","version_id","submission_id");--> statement-breakpoint
CREATE INDEX "audit_page_idx" ON "builder"."workspace_audit_events" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "builder"."workspace_audit_events" USING btree ("actor_user_id");