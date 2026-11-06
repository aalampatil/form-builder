import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, text, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { builder, id, object, timestamps, workspaceId, versionId, type StorageKind } from "./common";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./user";

export const formsTable = builder.table("forms", {
  id: id(),
  workspaceId: workspaceId().references(() => workspacesTable.id, { onDelete: "restrict" }),
  creatorUserId: uuid("creator_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  // Circular composite FK is installed in the lifecycle SQL migration.
  publishedVersionId: uuid("published_version_id"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps(),
}, (t) => [
  unique("forms_scope_unique").on(t.workspaceId, t.id),
  index("forms_creator_idx").on(t.creatorUserId),
  index("forms_published_version_idx").on(t.publishedVersionId),
  index("forms_workspace_page_idx").on(t.workspaceId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()).where(sql`${t.deletedAt} IS NULL`),
  check("forms_slug_check", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
]);

export const formVersionsTable = builder.table("form_versions", {
  id: id(), workspaceId: workspaceId(), formId: uuid("form_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  status: text("status").$type<"DRAFT" | "PUBLISHED">().notNull().default("DRAFT"),
  title: varchar("title", { length: 200 }).notNull(), description: text("description"),
  settings: object("settings"), revision: integer("revision").notNull().default(1),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...timestamps(),
}, (t) => [
  foreignKey({ columns: [t.workspaceId, t.formId], foreignColumns: [formsTable.workspaceId, formsTable.id], name: "versions_form_fk" }).onDelete("restrict"),
  unique("versions_scope_unique").on(t.workspaceId, t.id),
  unique("versions_form_scope_unique").on(t.workspaceId, t.formId, t.id),
  unique("versions_number_unique").on(t.workspaceId, t.formId, t.versionNumber),
  uniqueIndex("versions_one_draft_unique").on(t.workspaceId, t.formId).where(sql`${t.status} = 'DRAFT'`),
  check("versions_status_check", sql`(${t.status} = 'DRAFT' AND ${t.publishedAt} IS NULL) OR (${t.status} = 'PUBLISHED' AND ${t.publishedAt} IS NOT NULL)`),
  check("versions_number_check", sql`${t.versionNumber} > 0 AND ${t.revision} > 0`),
  check("versions_title_check", sql`length(btrim(${t.title})) > 0`),
  check("versions_settings_check", sql`jsonb_typeof(${t.settings}) = 'object'`),
]);

export const formStepsTable = builder.table("form_steps", {
  id: id(), workspaceId: workspaceId(), versionId: versionId(),
  key: varchar("key", { length: 80 }).notNull(), title: text("title"),
  position: integer("position").notNull(), ...timestamps(),
}, (t) => [
  foreignKey({ columns: [t.workspaceId, t.versionId], foreignColumns: [formVersionsTable.workspaceId, formVersionsTable.id], name: "steps_version_fk" }).onDelete("cascade"),
  unique("steps_scope_unique").on(t.workspaceId, t.versionId, t.id),
  unique("steps_key_unique").on(t.workspaceId, t.versionId, t.key),
  unique("steps_position_unique").on(t.workspaceId, t.versionId, t.position),
  check("steps_position_check", sql`${t.position} >= 0`),
  check("steps_key_check", sql`${t.key} ~ '^[a-zA-Z][a-zA-Z0-9_]*$'`),
]);

export const fieldTypesTable = builder.table("field_types", {
  code: text("code").primaryKey(),
  storageKind: text("storage_kind").$type<StorageKind>().notNull(),
}, (t) => [
  check("types_code_check", sql`${t.code} ~ '^[A-Z][A-Z0-9_]*$'`),
  check("types_kind_check", sql`${t.storageKind} IN ('TEXT','NUMBER','BOOLEAN','DATE','DATETIME','JSON','SINGLE_SELECT','MULTI_SELECT','FILE')`),
]);

export const formFieldsTable = builder.table("form_fields", {
  id: id(), workspaceId: workspaceId(), versionId: versionId(), stepId: uuid("step_id").notNull(),
  key: varchar("key", { length: 80 }).notNull(),
  typeCode: text("type_code").notNull().references(() => fieldTypesTable.code, { onDelete: "restrict" }),
  label: text("label").notNull(), helpText: text("help_text"),
  required: boolean("required").notNull().default(false), position: integer("position").notNull(),
  configuration: object("configuration"), validation: object("validation"), ...timestamps(),
}, (t) => [
  foreignKey({ columns: [t.workspaceId, t.versionId, t.stepId], foreignColumns: [formStepsTable.workspaceId, formStepsTable.versionId, formStepsTable.id], name: "fields_step_fk" }).onDelete("cascade"),
  unique("fields_scope_unique").on(t.workspaceId, t.versionId, t.id),
  unique("fields_key_unique").on(t.workspaceId, t.versionId, t.key),
  unique("fields_position_unique").on(t.workspaceId, t.versionId, t.stepId, t.position),
  index("fields_type_idx").on(t.typeCode),
  check("fields_position_check", sql`${t.position} >= 0`),
  check("fields_key_check", sql`${t.key} ~ '^[a-zA-Z][a-zA-Z0-9_]*$'`),
  check("fields_label_check", sql`length(btrim(${t.label})) > 0`),
  check("fields_configuration_check", sql`jsonb_typeof(${t.configuration}) = 'object' AND jsonb_typeof(${t.validation}) = 'object'`),
]);

export const fieldOptionsTable = builder.table("field_options", {
  id: id(), workspaceId: workspaceId(), versionId: versionId(), fieldId: uuid("field_id").notNull(),
  key: varchar("key", { length: 80 }).notNull(), label: text("label").notNull(),
  position: integer("position").notNull(), ...timestamps(),
}, (t) => [
  foreignKey({ columns: [t.workspaceId, t.versionId, t.fieldId], foreignColumns: [formFieldsTable.workspaceId, formFieldsTable.versionId, formFieldsTable.id], name: "options_field_fk" }).onDelete("cascade"),
  unique("options_scope_unique").on(t.workspaceId, t.versionId, t.fieldId, t.id),
  unique("options_key_unique").on(t.workspaceId, t.versionId, t.fieldId, t.key),
  unique("options_position_unique").on(t.workspaceId, t.versionId, t.fieldId, t.position),
  check("options_position_check", sql`${t.position} >= 0`),
  check("options_label_check", sql`length(btrim(${t.label})) > 0 AND length(btrim(${t.key})) > 0`),
]);

export const formLogicRulesTable = builder.table("form_logic_rules", {
  id: id(), workspaceId: workspaceId(), versionId: versionId(), sourceFieldId: uuid("source_field_id").notNull(),
  priority: integer("priority").notNull(), condition: object("condition"),
  actionKind: text("action_kind").$type<"GO_TO_STEP" | "SHOW_FIELD" | "HIDE_FIELD" | "END_FORM">().notNull(),
  targetStepId: uuid("target_step_id"), targetFieldId: uuid("target_field_id"), ...timestamps(),
}, (t) => [
  foreignKey({ columns: [t.workspaceId, t.versionId, t.sourceFieldId], foreignColumns: [formFieldsTable.workspaceId, formFieldsTable.versionId, formFieldsTable.id], name: "logic_source_fk" }).onDelete("cascade"),
  foreignKey({ columns: [t.workspaceId, t.versionId, t.targetFieldId], foreignColumns: [formFieldsTable.workspaceId, formFieldsTable.versionId, formFieldsTable.id], name: "logic_field_target_fk" }).onDelete("restrict"),
  foreignKey({ columns: [t.workspaceId, t.versionId, t.targetStepId], foreignColumns: [formStepsTable.workspaceId, formStepsTable.versionId, formStepsTable.id], name: "logic_step_target_fk" }).onDelete("restrict"),
  unique("logic_priority_unique").on(t.workspaceId, t.versionId, t.priority),
  index("logic_source_idx").on(t.workspaceId, t.versionId, t.sourceFieldId),
  index("logic_field_target_idx").on(t.workspaceId, t.versionId, t.targetFieldId),
  index("logic_step_target_idx").on(t.workspaceId, t.versionId, t.targetStepId),
  check("logic_priority_check", sql`${t.priority} >= 0`),
  check("logic_condition_check", sql`jsonb_typeof(${t.condition}) = 'object' AND ${t.condition} ? 'formatVersion' AND ${t.condition}->'formatVersion' = '1'::jsonb`),
  check("logic_action_check", sql`(${t.actionKind} = 'GO_TO_STEP' AND ${t.targetStepId} IS NOT NULL AND ${t.targetFieldId} IS NULL) OR (${t.actionKind} IN ('SHOW_FIELD','HIDE_FIELD') AND ${t.targetFieldId} IS NOT NULL AND ${t.targetStepId} IS NULL) OR (${t.actionKind} = 'END_FORM' AND ${t.targetStepId} IS NULL AND ${t.targetFieldId} IS NULL)`),
]);

export type SelectForm = typeof formsTable.$inferSelect;
export type InsertForm = typeof formsTable.$inferInsert;
export type SelectFormVersion = typeof formVersionsTable.$inferSelect;
export type InsertFormVersion = typeof formVersionsTable.$inferInsert;
export type SelectFormStep = typeof formStepsTable.$inferSelect;
export type InsertFormStep = typeof formStepsTable.$inferInsert;
export type SelectFormField = typeof formFieldsTable.$inferSelect;
export type InsertFormField = typeof formFieldsTable.$inferInsert;
export type SelectFieldOption = typeof fieldOptionsTable.$inferSelect;
export type InsertFieldOption = typeof fieldOptionsTable.$inferInsert;
export type SelectFormLogicRule = typeof formLogicRulesTable.$inferSelect;
export type InsertFormLogicRule = typeof formLogicRulesTable.$inferInsert;
