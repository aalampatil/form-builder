import {
  pgEnum,
  pgTable,
  uuid,
  timestamp,
  text,
  jsonb,
  index,
  inet,
} from "drizzle-orm/pg-core";
import { formsTable, formFieldsTable } from "./form";

export const responseStatusEnum = pgEnum("response_status", ["COMPLETED", "PARTIAL"]);

export const formResponsesTable = pgTable(
  "form_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    formId: uuid("form_id")
      .notNull()
      .references(() => formsTable.id, { onDelete: "cascade" }),

    respondentEmail: text("respondent_email"),

    ip: inet("ip"),
    userAgent: text("user_agent"),

    status: responseStatusEnum("status").notNull().default("COMPLETED"),
    submittedAt: timestamp("submitted_at"),

    answersSnapshot: jsonb("answers_snapshot").notNull().default({}),
    meta: jsonb("meta").notNull().default({}),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    formIdx: index("form_responses_form_id_idx").on(t.formId),
    submittedAtIdx: index("form_responses_form_id_submitted_at_idx").on(t.formId, t.submittedAt),
  }),
);

export const formResponseAnswersTable = pgTable(
  "form_response_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    responseId: uuid("response_id")
      .notNull()
      .references(() => formResponsesTable.id, { onDelete: "cascade" }),

    fieldId: uuid("field_id").references(() => formFieldsTable.id, { onDelete: "set null" }),
    fieldKey: text("field_key").notNull(),

    value: jsonb("value").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    responseIdx: index("form_response_answers_response_id_idx").on(t.responseId),
    responseFieldKeyIdx: index("form_response_answers_response_id_field_key_idx").on(
      t.responseId,
      t.fieldKey,
    ),
  }),
);

export type SelectFormResponse = typeof formResponsesTable.$inferSelect;
export type InsertFormResponse = typeof formResponsesTable.$inferInsert;
export type SelectFormResponseAnswer = typeof formResponseAnswersTable.$inferSelect;
export type InsertFormResponseAnswer = typeof formResponseAnswersTable.$inferInsert;

