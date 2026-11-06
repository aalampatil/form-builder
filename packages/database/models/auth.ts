import { pgTable, uuid, timestamp, text, index, inet, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./user";

export const sessionsTable = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    tokenHash: text("token_hash").notNull(),

    ip: inet("ip"),
    userAgent: text("user_agent"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex("sessions_token_hash_unique").on(t.tokenHash),
    userIdIdx: index("sessions_user_id_idx").on(t.userId),
    expiryIdx: index("sessions_expiry_idx").on(t.expiresAt),
  }),
);

export type SelectSession = typeof sessionsTable.$inferSelect;
export type InsertSession = typeof sessionsTable.$inferInsert;
