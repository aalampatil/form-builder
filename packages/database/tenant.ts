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
    const identity = await transaction.execute(sql`
      SELECT r.rolsuper OR r.rolbypassrls
        OR pg_has_role(current_user, 'builder_maintenance', 'MEMBER')
        OR pg_has_role(current_user, (SELECT nspowner FROM pg_namespace WHERE nspname = 'builder'), 'USAGE') AS privileged,
        pg_has_role(current_user, 'builder_runtime', 'USAGE') AS runtime
      FROM pg_roles r WHERE rolname = current_user
    `);
    if (identity.rows[0]?.privileged !== false || identity.rows[0]?.runtime !== true) {
      throw new Error("Workspace transactions require a non-owner builder_runtime connection");
    }
    await transaction.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
    await transaction.execute(
      sql`SELECT set_config('app.actor_user_id', ${actorUserId ?? ""}, true)`,
    );
    return operation(transaction);
  });
}
