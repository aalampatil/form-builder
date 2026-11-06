import "dotenv/config";
import { Pool } from "pg";

// Deliberately no passwords or privileged demo accounts. Never seed production.
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || process.env.ALLOW_DATABASE_SEED !== "true" || process.env.NODE_ENV === "production") {
    throw new Error(
      "Development seed requires DATABASE_URL and ALLOW_DATABASE_SEED=true outside production",
    );
  }
  if (!/_(dev|test)$/.test(new URL(url).pathname)) {
    throw new Error("Seed database name must end in _dev or _test");
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const {
      rows: [user],
    } = await client.query(
      `INSERT INTO public.users (full_name, email) VALUES ('Database Fixture', 'fixture@example.invalid')
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`,
    );
    const {
      rows: [workspace],
    } = await client.query(
      `INSERT INTO builder.workspaces (name, slug, owner_user_id) VALUES ('Development', 'development', $1)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [user.id],
    );
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspace.id]);
    const {
      rows: [form],
    } = await client.query(
      `INSERT INTO builder.forms (workspace_id, creator_user_id, slug) VALUES ($1, $2, 'development-feedback')
       ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
      [workspace.id, user.id],
    );
    const {
      rows: [version],
    } = await client.query(
      `INSERT INTO builder.form_versions (workspace_id, form_id, version_number, title)
       VALUES ($1, $2, 1, 'Development feedback') ON CONFLICT DO NOTHING RETURNING id`,
      [workspace.id, form.id],
    );
    if (version) {
      const {
        rows: [step],
      } = await client.query(
        `INSERT INTO builder.form_steps (workspace_id, version_id, key, position)
         VALUES ($1, $2, 'main', 0) RETURNING id`,
        [workspace.id, version.id],
      );
      await client.query(
        `INSERT INTO builder.form_fields (workspace_id, version_id, step_id, key, type_code, label, position)
         VALUES ($1, $2, $3, 'feedback', 'LONG_TEXT', 'Your feedback', 0)`,
        [workspace.id, version.id, step.id],
      );
    }
    await client.query("COMMIT");
    console.log("Development draft fixture ready (no login credentials created).");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
