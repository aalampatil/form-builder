import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, foreignKey, index, jsonb, numeric, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { builder, id, object, timestamps, workspaceId, versionId, type StorageKind } from "./common";
import { formsTable, formVersionsTable, formFieldsTable, fieldOptionsTable } from "./definitions";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./user";

export const formSubmissionsTable = builder.table("form_submissions", {
  id: id(), workspaceId: workspaceId(), formId: uuid("form_id").notNull(), versionId: versionId(),
  respondentUserId: uuid("respondent_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  status: text("status").$type<"IN_PROGRESS" | "COMPLETED" | "ABANDONED">().notNull().default("IN_PROGRESS"),
  idempotencyKey: text("idempotency_key"), metadata: object("metadata"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }), ...timestamps(),
}, (t) => [
  foreignKey({ columns: [t.workspaceId, t.formId, t.versionId], foreignColumns: [formVersionsTable.workspaceId, formVersionsTable.formId, formVersionsTable.id], name: "submissions_version_fk" }).onDelete("restrict"),
  unique("submissions_scope_unique").on(t.workspaceId, t.versionId, t.id),
  uniqueIndex("submissions_idempotency_unique").on(t.workspaceId, t.formId, t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
  index("submissions_page_idx").on(t.workspaceId, t.formId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()).where(sql`${t.deletedAt} IS NULL`),
  index("submissions_completed_idx").on(t.workspaceId, t.formId, t.completedAt.desc().nullsFirst(), t.id.desc().nullsFirst()).where(sql`${t.deletedAt} IS NULL AND ${t.status} = 'COMPLETED'`),
  index("submissions_version_idx").on(t.workspaceId, t.versionId),
  index("submissions_respondent_idx").on(t.respondentUserId),
  index("submissions_expiry_idx").on(t.expiresAt, t.id).where(sql`${t.expiresAt} IS NOT NULL`),
  check("submissions_status_check", sql`(${t.status} = 'COMPLETED' AND ${t.completedAt} IS NOT NULL AND ${t.completedAt} >= ${t.startedAt}) OR (${t.status} IN ('IN_PROGRESS','ABANDONED') AND ${t.completedAt} IS NULL)`),
  check("submissions_expiry_check", sql`${t.expiresAt} IS NULL OR ${t.expiresAt} >= ${t.startedAt}`),
  check("submissions_metadata_check", sql`jsonb_typeof(${t.metadata}) = 'object'`),
  check("submissions_idempotency_check", sql`${t.idempotencyKey} IS NULL OR length(${t.idempotencyKey}) BETWEEN 1 AND 200`),
]);

export const submissionAnswersTable = builder.table("submission_answers", {
  id: id(), workspaceId: workspaceId(), versionId: versionId(), submissionId: uuid("submission_id").notNull(), fieldId: uuid("field_id").notNull(),
  storageKind: text("storage_kind").$type<StorageKind>().notNull(),
  valueText: text("value_text"), valueNumber: numeric("value_number"), valueBoolean: boolean("value_boolean"),
  valueDate: date("value_date", { mode: "string" }), valueDatetime: timestamp("value_datetime", { withTimezone: true }),
  valueJson: jsonb("value_json").$type<unknown>(), ...timestamps(),
}, (t) => [
  foreignKey({ columns: [t.workspaceId, t.versionId, t.submissionId], foreignColumns: [formSubmissionsTable.workspaceId, formSubmissionsTable.versionId, formSubmissionsTable.id], name: "answers_submission_fk" }).onDelete("cascade"),
  foreignKey({ columns: [t.workspaceId, t.versionId, t.fieldId], foreignColumns: [formFieldsTable.workspaceId, formFieldsTable.versionId, formFieldsTable.id], name: "answers_field_fk" }).onDelete("restrict"),
  unique("answers_field_unique").on(t.workspaceId, t.submissionId, t.fieldId),
  unique("answers_field_scope_unique").on(t.workspaceId, t.versionId, t.id, t.fieldId),
  unique("answers_submission_scope_unique").on(t.workspaceId, t.versionId, t.submissionId, t.id),
  index("answers_field_idx").on(t.workspaceId, t.versionId, t.fieldId),
  index("answers_numeric_idx").on(t.workspaceId, t.fieldId, t.valueNumber, t.submissionId).where(sql`${t.valueNumber} IS NOT NULL`),
  index("answers_date_idx").on(t.workspaceId, t.fieldId, t.valueDate, t.submissionId).where(sql`${t.valueDate} IS NOT NULL`),
  check("answers_payload_check", sql`(
    (${t.storageKind} = 'TEXT' AND ${t.valueText} IS NOT NULL) OR
    (${t.storageKind} = 'NUMBER' AND ${t.valueNumber} IS NOT NULL AND ${t.valueNumber} NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) OR
    (${t.storageKind} = 'BOOLEAN' AND ${t.valueBoolean} IS NOT NULL) OR
    (${t.storageKind} = 'DATE' AND ${t.valueDate} IS NOT NULL AND isfinite(${t.valueDate})) OR
    (${t.storageKind} = 'DATETIME' AND ${t.valueDatetime} IS NOT NULL AND isfinite(${t.valueDatetime})) OR
    (${t.storageKind} = 'JSON' AND ${t.valueJson} IS NOT NULL AND ${t.valueJson} <> 'null'::jsonb) OR
    ${t.storageKind} IN ('SINGLE_SELECT','MULTI_SELECT','FILE')
  ) AND num_nonnulls(${t.valueText}, ${t.valueNumber}, ${t.valueBoolean}, ${t.valueDate}, ${t.valueDatetime}, ${t.valueJson}) = CASE WHEN ${t.storageKind} IN ('SINGLE_SELECT','MULTI_SELECT','FILE') THEN 0 ELSE 1 END`),
]);

export const answerSelectionsTable = builder.table("answer_selections", {
  workspaceId: workspaceId(), versionId: versionId(), answerId: uuid("answer_id").notNull(),
  fieldId: uuid("field_id").notNull(), optionId: uuid("option_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.answerId, t.optionId] }),
  foreignKey({ columns: [t.workspaceId, t.versionId, t.answerId, t.fieldId], foreignColumns: [submissionAnswersTable.workspaceId, submissionAnswersTable.versionId, submissionAnswersTable.id, submissionAnswersTable.fieldId], name: "selections_answer_fk" }).onDelete("cascade"),
  foreignKey({ columns: [t.workspaceId, t.versionId, t.fieldId, t.optionId], foreignColumns: [fieldOptionsTable.workspaceId, fieldOptionsTable.versionId, fieldOptionsTable.fieldId, fieldOptionsTable.id], name: "selections_option_fk" }).onDelete("restrict"),
  index("selections_option_idx").on(t.workspaceId, t.versionId, t.fieldId, t.optionId),
  index("selections_analytics_idx").on(t.workspaceId, t.optionId, t.answerId),
]);

export const submissionFilesTable = builder.table("submission_files", {
  id: id(), workspaceId: workspaceId(), versionId: versionId(), submissionId: uuid("submission_id").notNull(),
  objectKey: text("object_key").notNull().unique(), originalFilename: text("original_filename").notNull(), mediaType: text("media_type").notNull(),
  byteCount: bigint("byte_count", { mode: "bigint" }).notNull(), checksum: text("checksum"),
  uploadState: text("upload_state").$type<"PENDING" | "READY" | "REJECTED">().notNull().default("PENDING"), ...timestamps(),
}, (t) => [
  foreignKey({ columns: [t.workspaceId, t.versionId, t.submissionId], foreignColumns: [formSubmissionsTable.workspaceId, formSubmissionsTable.versionId, formSubmissionsTable.id], name: "files_submission_fk" }).onDelete("cascade"),
  unique("files_scope_unique").on(t.workspaceId, t.versionId, t.submissionId, t.id),
  index("files_submission_idx").on(t.workspaceId, t.versionId, t.submissionId),
  check("files_size_check", sql`${t.byteCount} >= 0`),
  check("files_state_check", sql`${t.uploadState} IN ('PENDING','READY','REJECTED')`),
  check("files_metadata_check", sql`length(btrim(${t.objectKey})) > 0 AND length(btrim(${t.originalFilename})) > 0 AND length(btrim(${t.mediaType})) > 0`),
]);

export const answerFilesTable = builder.table("answer_files", {
  workspaceId: workspaceId(), versionId: versionId(), submissionId: uuid("submission_id").notNull(),
  answerId: uuid("answer_id").notNull(), fileId: uuid("file_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.answerId, t.fileId] }),
  foreignKey({ columns: [t.workspaceId, t.versionId, t.submissionId, t.answerId], foreignColumns: [submissionAnswersTable.workspaceId, submissionAnswersTable.versionId, submissionAnswersTable.submissionId, submissionAnswersTable.id], name: "attachments_answer_fk" }).onDelete("cascade"),
  foreignKey({ columns: [t.workspaceId, t.versionId, t.submissionId, t.fileId], foreignColumns: [submissionFilesTable.workspaceId, submissionFilesTable.versionId, submissionFilesTable.submissionId, submissionFilesTable.id], name: "attachments_file_fk" }).onDelete("cascade"),
  index("attachments_file_idx").on(t.workspaceId, t.versionId, t.submissionId, t.fileId),
]);

export const workspaceAuditEventsTable = builder.table("workspace_audit_events", {
  id: id(), workspaceId: workspaceId().references(() => workspacesTable.id, { onDelete: "restrict" }),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: text("action").notNull(), entityType: text("entity_type").notNull(), entityId: uuid("entity_id"),
  metadata: object("metadata"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_page_idx").on(t.workspaceId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
  index("audit_actor_idx").on(t.actorUserId),
  check("audit_metadata_check", sql`jsonb_typeof(${t.metadata}) = 'object' AND octet_length(${t.metadata}::text) <= 8192`),
  check("audit_action_check", sql`length(btrim(${t.action})) > 0 AND length(btrim(${t.entityType})) > 0`),
]);

export type SelectFormSubmission = typeof formSubmissionsTable.$inferSelect;
export type InsertFormSubmission = typeof formSubmissionsTable.$inferInsert;
export type SelectSubmissionAnswer = typeof submissionAnswersTable.$inferSelect;
export type InsertSubmissionAnswer = typeof submissionAnswersTable.$inferInsert;
export type SelectAnswerSelection = typeof answerSelectionsTable.$inferSelect;
export type InsertAnswerSelection = typeof answerSelectionsTable.$inferInsert;
export type SelectSubmissionFile = typeof submissionFilesTable.$inferSelect;
export type InsertSubmissionFile = typeof submissionFilesTable.$inferInsert;
export type SelectAnswerFile = typeof answerFilesTable.$inferSelect;
export type InsertAnswerFile = typeof answerFilesTable.$inferInsert;
export type SelectWorkspaceAuditEvent = typeof workspaceAuditEventsTable.$inferSelect;
export type InsertWorkspaceAuditEvent = typeof workspaceAuditEventsTable.$inferInsert;
