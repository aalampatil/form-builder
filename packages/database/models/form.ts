import {
  pgEnum,
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  text,
  jsonb,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./user";
import { themesTable } from "./theme";

export const formVisibilityEnum = pgEnum("form_visibility", ["PUBLIC", "UNLISTED"]);
export const formStatusEnum = pgEnum("form_status", ["DRAFT", "PUBLISHED", "ARCHIVED"]);

export const fieldTypeEnum = pgEnum("field_type", [
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

export const formsTable = pgTable(
  "forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    ownerId: uuid("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    title: varchar("title", { length: 140 }).notNull(),
    description: text("description"),

    slug: varchar("slug", { length: 120 }).notNull(),

    status: formStatusEnum("status").notNull().default("DRAFT"),
    visibility: formVisibilityEnum("visibility").notNull().default("UNLISTED"),

    themeId: uuid("theme_id").references(() => themesTable.id, { onDelete: "set null" }),

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

export const formFieldsTable = pgTable(
  "form_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    formId: uuid("form_id")
      .notNull()
      .references(() => formsTable.id, { onDelete: "cascade" }),

    key: varchar("key", { length: 80 }).notNull(),
    type: fieldTypeEnum("type").notNull(),

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

export type SelectForm = typeof formsTable.$inferSelect;
export type InsertForm = typeof formsTable.$inferInsert;
export type SelectFormField = typeof formFieldsTable.$inferSelect;
export type InsertFormField = typeof formFieldsTable.$inferInsert;

