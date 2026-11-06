// Compatibility-only mapping of existing public tables. Do not use for new writes.
import { pgEnum, pgTable, uuid, varchar, timestamp, boolean, text, jsonb, integer, index, uniqueIndex, inet } from "drizzle-orm/pg-core";
import { usersTable } from "./user";
export const legacyFormVisibilityEnum = pgEnum("form_visibility", ["PUBLIC", "UNLISTED"]);
export const legacyFormStatusEnum = pgEnum("form_status", ["DRAFT", "PUBLISHED", "ARCHIVED"]);

export const legacyFieldTypeEnum = pgEnum("field_type", [
  "SHORT_TEXT",
  "LONG_TEXT",
  "EMAIL",
  "NUMBER",
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "DROPDOWN",
  "CHECKBOX",
  "RATING",
  "DATE",
]);

export const legacyFormsTable = pgTable(
  "forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    ownerId: uuid("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    // Legacy owner cascade is replaced by RESTRICT in the hardening migration.

    title: varchar("title", { length: 140 }).notNull(),
    description: text("description"),

    slug: varchar("slug", { length: 120 }).notNull(),

    status: legacyFormStatusEnum("status").notNull().default("DRAFT"),
    visibility: legacyFormVisibilityEnum("visibility").notNull().default("UNLISTED"),

    themeId: uuid("theme_id").references(() => legacyThemesTable.id, { onDelete: "set null" }),

    settings: jsonb("settings").notNull().default({}),

    passwordHash: text("password_hash"),

    publishedAt: timestamp("published_at"),
    unpublishedAt: timestamp("unpublished_at"),

    archivedAt: timestamp("archived_at"),

    expiresAt: timestamp("expires_at"),
    responseLimit: integer("response_limit"),
    allowMultipleSubmissionsPerIp: boolean("allow_multiple_submissions_per_ip")
      .notNull()
      .default(true),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => ({
    ownerIdx: index("forms_owner_id_idx").on(t.ownerId),
    statusIdx: index("forms_status_idx").on(t.status),
    visibilityIdx: index("forms_visibility_idx").on(t.visibility),
    slugUnique: uniqueIndex("forms_slug_unique").on(t.slug),
  }),
);

export const legacyFormFieldsTable = pgTable(
  "form_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    formId: uuid("form_id")
      .notNull()
      .references(() => legacyFormsTable.id, { onDelete: "cascade" }),

    key: varchar("key", { length: 80 }).notNull(),
    type: legacyFieldTypeEnum("type").notNull(),

    label: varchar("label", { length: 160 }).notNull(),
    helpText: text("help_text"),
    placeholder: varchar("placeholder", { length: 180 }),

    required: boolean("required").notNull().default(false),
    order: integer("order").notNull().default(0),

    config: jsonb("config").notNull().default({}),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => ({
    formIdx: index("form_fields_form_id_idx").on(t.formId),
    formOrderIdx: index("form_fields_form_order_idx").on(t.formId, t.order),
    formKeyUnique: uniqueIndex("form_fields_form_id_key_unique").on(t.formId, t.key),
  }),
);

export type LegacySelectForm = typeof legacyFormsTable.$inferSelect;
export type LegacyInsertForm = typeof legacyFormsTable.$inferInsert;
export type LegacySelectFormField = typeof legacyFormFieldsTable.$inferSelect;
export type LegacyInsertFormField = typeof legacyFormFieldsTable.$inferInsert;

export const legacyResponseStatusEnum = pgEnum("response_status", ["COMPLETED", "PARTIAL"]);

export const legacyFormResponsesTable = pgTable(
  "form_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    formId: uuid("form_id")
      .notNull()
      .references(() => legacyFormsTable.id, { onDelete: "cascade" }),

    respondentEmail: text("respondent_email"),

    ip: inet("ip"),
    userAgent: text("user_agent"),

    status: legacyResponseStatusEnum("status").notNull().default("COMPLETED"),
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

export const legacyFormResponseAnswersTable = pgTable(
  "form_response_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    responseId: uuid("response_id")
      .notNull()
      .references(() => legacyFormResponsesTable.id, { onDelete: "cascade" }),

    fieldId: uuid("field_id").references(() => legacyFormFieldsTable.id, { onDelete: "set null" }),
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

export type LegacySelectFormResponse = typeof legacyFormResponsesTable.$inferSelect;
export type LegacyInsertFormResponse = typeof legacyFormResponsesTable.$inferInsert;
export type LegacySelectFormResponseAnswer = typeof legacyFormResponseAnswersTable.$inferSelect;
export type LegacyInsertFormResponseAnswer = typeof legacyFormResponseAnswersTable.$inferInsert;

export const legacyThemesTable = pgTable(
  "themes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    ownerId: uuid("owner_id").references(() => usersTable.id, { onDelete: "set null" }),

    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    category: varchar("category", { length: 60 }),

    coverImageUrl: text("cover_image_url"),

    palette: jsonb("palette").notNull().default({}),
    typography: jsonb("typography").notNull().default({}),
    extras: jsonb("extras").notNull().default({}),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => ({
    ownerIdx: index("themes_owner_id_idx").on(t.ownerId),
    categoryIdx: index("themes_category_idx").on(t.category),
  }),
);

export type LegacySelectTheme = typeof legacyThemesTable.$inferSelect;
export type LegacyInsertTheme = typeof legacyThemesTable.$inferInsert;
