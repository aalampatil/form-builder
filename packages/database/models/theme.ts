import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./user";

export const themesTable = pgTable(
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

export type SelectTheme = typeof themesTable.$inferSelect;
export type InsertTheme = typeof themesTable.$inferInsert;

