import { sql } from "drizzle-orm";
import { check, index, integer, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { builder, id, timestamps, workspaceId } from "./common";
import { usersTable } from "./user";

export const workspacesTable = builder.table(
  "workspaces",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull().unique(),
    retentionDays: integer("retention_days"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("workspaces_owner_idx").on(t.ownerUserId),
    check("workspaces_retention_check", sql`${t.retentionDays} > 0`),
    check("workspaces_name_check", sql`length(btrim(${t.name})) > 0`),
    check("workspaces_slug_check", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const workspaceMembershipsTable = builder.table(
  "workspace_memberships",
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspacesTable.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: text("role").$type<"ADMIN" | "EDITOR" | "VIEWER">().notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("memberships_workspace_user_unique").on(t.workspaceId, t.userId),
    index("memberships_user_workspace_idx").on(t.userId, t.workspaceId),
    check("memberships_role_check", sql`${t.role} IN ('ADMIN', 'EDITOR', 'VIEWER')`),
  ],
);

export type SelectWorkspace = typeof workspacesTable.$inferSelect;
export type InsertWorkspace = typeof workspacesTable.$inferInsert;
export type SelectWorkspaceMembership = typeof workspaceMembershipsTable.$inferSelect;
export type InsertWorkspaceMembership = typeof workspaceMembershipsTable.$inferInsert;
