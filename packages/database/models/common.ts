import { pgSchema, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";

// Separate namespace permits a safe expansion beside the historical public tables.
export const builder = pgSchema("builder");
export const id = () => uuid("id").primaryKey().defaultRandom();
export const workspaceId = () => uuid("workspace_id").notNull();
export const versionId = () => uuid("version_id").notNull();
export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const object = (name: string) =>
  jsonb(name).$type<Record<string, unknown>>().notNull().default({});

export const storageKinds = [
  "TEXT",
  "NUMBER",
  "BOOLEAN",
  "DATE",
  "DATETIME",
  "JSON",
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "FILE",
] as const;
export type StorageKind = (typeof storageKinds)[number];
