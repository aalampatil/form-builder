import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

type Database = NodePgDatabase;
export type WorkspaceTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Caller must authorize actor access to workspace before calling this helper.
 * Tenant context provides isolation, not proof of membership or role permission.
 * Use a dedicated non-owner connection with builder_runtime privileges.
 */
export async function withAuthorizedWorkspace<T>(
  database: Database,
  workspaceId: string,
  operation: (transaction: WorkspaceTransaction) => Promise<T>,
  actorUserId?: string,
): Promise<T> {
  if (!uuid.test(workspaceId) || (actorUserId !== undefined && !uuid.test(actorUserId))) {
    throw new Error("Workspace and actor IDs must be UUIDs");
  }
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
    await transaction.execute(sql`SELECT set_config('app.actor_user_id', ${actorUserId ?? ""}, true)`);
    return operation(transaction);
  });
}
