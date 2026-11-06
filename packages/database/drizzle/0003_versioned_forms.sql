CREATE SCHEMA IF NOT EXISTS "builder";
--> statement-breakpoint
CREATE TABLE "builder"."field_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"key" varchar(80) NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "options_scope_unique" UNIQUE("workspace_id","version_id","field_id","id"),
	CONSTRAINT "options_key_unique" UNIQUE("workspace_id","version_id","field_id","key"),
	CONSTRAINT "options_position_unique" UNIQUE("workspace_id","version_id","field_id","position"),
	CONSTRAINT "options_position_check" CHECK ("builder"."field_options"."position" >= 0),
	CONSTRAINT "options_label_check" CHECK (length(btrim("builder"."field_options"."label")) > 0 AND length(btrim("builder"."field_options"."key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "builder"."field_types" (
	"code" text PRIMARY KEY NOT NULL,
	"storage_kind" text NOT NULL,
	CONSTRAINT "types_code_check" CHECK ("builder"."field_types"."code" ~ '^[A-Z][A-Z0-9_]*$'),
	CONSTRAINT "types_kind_check" CHECK ("builder"."field_types"."storage_kind" IN ('TEXT','NUMBER','BOOLEAN','DATE','DATETIME','JSON','SINGLE_SELECT','MULTI_SELECT','FILE'))
);
--> statement-breakpoint
CREATE TABLE "builder"."form_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"key" varchar(80) NOT NULL,
	"type_code" text NOT NULL,
	"label" text NOT NULL,
	"help_text" text,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fields_scope_unique" UNIQUE("workspace_id","version_id","id"),
	CONSTRAINT "fields_key_unique" UNIQUE("workspace_id","version_id","key"),
	CONSTRAINT "fields_position_unique" UNIQUE("workspace_id","version_id","step_id","position"),
	CONSTRAINT "fields_position_check" CHECK ("builder"."form_fields"."position" >= 0),
	CONSTRAINT "fields_key_check" CHECK ("builder"."form_fields"."key" ~ '^[a-zA-Z][a-zA-Z0-9_]*$'),
	CONSTRAINT "fields_label_check" CHECK (length(btrim("builder"."form_fields"."label")) > 0),
	CONSTRAINT "fields_configuration_check" CHECK (jsonb_typeof("builder"."form_fields"."configuration") = 'object' AND jsonb_typeof("builder"."form_fields"."validation") = 'object')
);
--> statement-breakpoint
CREATE TABLE "builder"."form_logic_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"source_field_id" uuid NOT NULL,
	"priority" integer NOT NULL,
	"condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_kind" text NOT NULL,
	"target_step_id" uuid,
	"target_field_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "logic_priority_unique" UNIQUE("workspace_id","version_id","priority"),
	CONSTRAINT "logic_priority_check" CHECK ("builder"."form_logic_rules"."priority" >= 0),
	CONSTRAINT "logic_condition_check" CHECK (jsonb_typeof("builder"."form_logic_rules"."condition") = 'object' AND "builder"."form_logic_rules"."condition" ? 'formatVersion' AND "builder"."form_logic_rules"."condition"->'formatVersion' = '1'::jsonb),
	CONSTRAINT "logic_action_check" CHECK (("builder"."form_logic_rules"."action_kind" = 'GO_TO_STEP' AND "builder"."form_logic_rules"."target_step_id" IS NOT NULL AND "builder"."form_logic_rules"."target_field_id" IS NULL) OR ("builder"."form_logic_rules"."action_kind" IN ('SHOW_FIELD','HIDE_FIELD') AND "builder"."form_logic_rules"."target_field_id" IS NOT NULL AND "builder"."form_logic_rules"."target_step_id" IS NULL) OR ("builder"."form_logic_rules"."action_kind" = 'END_FORM' AND "builder"."form_logic_rules"."target_step_id" IS NULL AND "builder"."form_logic_rules"."target_field_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "builder"."form_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"key" varchar(80) NOT NULL,
	"title" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "steps_scope_unique" UNIQUE("workspace_id","version_id","id"),
	CONSTRAINT "steps_key_unique" UNIQUE("workspace_id","version_id","key"),
	CONSTRAINT "steps_position_unique" UNIQUE("workspace_id","version_id","position"),
	CONSTRAINT "steps_position_check" CHECK ("builder"."form_steps"."position" >= 0),
	CONSTRAINT "steps_key_check" CHECK ("builder"."form_steps"."key" ~ '^[a-zA-Z][a-zA-Z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "builder"."form_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "versions_scope_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "versions_form_scope_unique" UNIQUE("workspace_id","form_id","id"),
	CONSTRAINT "versions_number_unique" UNIQUE("workspace_id","form_id","version_number"),
	CONSTRAINT "versions_status_check" CHECK (("builder"."form_versions"."status" = 'DRAFT' AND "builder"."form_versions"."published_at" IS NULL) OR ("builder"."form_versions"."status" = 'PUBLISHED' AND "builder"."form_versions"."published_at" IS NOT NULL)),
	CONSTRAINT "versions_number_check" CHECK ("builder"."form_versions"."version_number" > 0 AND "builder"."form_versions"."revision" > 0),
	CONSTRAINT "versions_title_check" CHECK (length(btrim("builder"."form_versions"."title")) > 0),
	CONSTRAINT "versions_settings_check" CHECK (jsonb_typeof("builder"."form_versions"."settings") = 'object')
);
--> statement-breakpoint
CREATE TABLE "builder"."forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"creator_user_id" uuid,
	"slug" varchar(120) NOT NULL,
	"published_version_id" uuid,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forms_slug_unique" UNIQUE("slug"),
	CONSTRAINT "forms_scope_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "forms_slug_check" CHECK ("builder"."forms"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "builder"."field_options" ADD CONSTRAINT "options_field_fk" FOREIGN KEY ("workspace_id","version_id","field_id") REFERENCES "builder"."form_fields"("workspace_id","version_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."form_fields" ADD CONSTRAINT "form_fields_type_code_field_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "builder"."field_types"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."form_fields" ADD CONSTRAINT "fields_step_fk" FOREIGN KEY ("workspace_id","version_id","step_id") REFERENCES "builder"."form_steps"("workspace_id","version_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."form_logic_rules" ADD CONSTRAINT "logic_source_fk" FOREIGN KEY ("workspace_id","version_id","source_field_id") REFERENCES "builder"."form_fields"("workspace_id","version_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."form_logic_rules" ADD CONSTRAINT "logic_field_target_fk" FOREIGN KEY ("workspace_id","version_id","target_field_id") REFERENCES "builder"."form_fields"("workspace_id","version_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."form_logic_rules" ADD CONSTRAINT "logic_step_target_fk" FOREIGN KEY ("workspace_id","version_id","target_step_id") REFERENCES "builder"."form_steps"("workspace_id","version_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."form_steps" ADD CONSTRAINT "steps_version_fk" FOREIGN KEY ("workspace_id","version_id") REFERENCES "builder"."form_versions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."form_versions" ADD CONSTRAINT "versions_form_fk" FOREIGN KEY ("workspace_id","form_id") REFERENCES "builder"."forms"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."forms" ADD CONSTRAINT "forms_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "builder"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder"."forms" ADD CONSTRAINT "forms_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fields_type_idx" ON "builder"."form_fields" USING btree ("type_code");--> statement-breakpoint
CREATE INDEX "logic_source_idx" ON "builder"."form_logic_rules" USING btree ("workspace_id","version_id","source_field_id");--> statement-breakpoint
CREATE INDEX "logic_field_target_idx" ON "builder"."form_logic_rules" USING btree ("workspace_id","version_id","target_field_id");--> statement-breakpoint
CREATE INDEX "logic_step_target_idx" ON "builder"."form_logic_rules" USING btree ("workspace_id","version_id","target_step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "versions_one_draft_unique" ON "builder"."form_versions" USING btree ("workspace_id","form_id") WHERE "builder"."form_versions"."status" = 'DRAFT';--> statement-breakpoint
CREATE INDEX "forms_creator_idx" ON "builder"."forms" USING btree ("creator_user_id");--> statement-breakpoint
CREATE INDEX "forms_published_version_idx" ON "builder"."forms" USING btree ("published_version_id");--> statement-breakpoint
CREATE INDEX "forms_workspace_page_idx" ON "builder"."forms" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "builder"."forms"."deleted_at" IS NULL;
