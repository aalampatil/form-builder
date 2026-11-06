import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { withAuthorizedWorkspace } from "../tenant";

const migrationsFolder = path.resolve(__dirname, "../drizzle");
const adminUrl = process.env.TEST_DATABASE_URL;
// This suite NEVER reads DATABASE_URL. It creates and drops only its own databases.
if (!adminUrl || !new URL(adminUrl).pathname.endsWith("_test")) {
  throw new Error(
    "Set TEST_DATABASE_URL to a disposable PostgreSQL admin database ending in _test",
  );
}
const admin = new Pool({ connectionString: adminUrl, max: 2 });
const ownedDatabases: string[] = [];

async function database() {
  const name = `fb_${randomUUID().replaceAll("-", "")}_test`;
  await admin.query(`CREATE DATABASE "${name}"`);
  ownedDatabases.push(name);
  const url = new URL(adminUrl!);
  url.pathname = `/${name}`;
  return new Pool({ connectionString: url.toString(), max: 5 });
}

async function transaction<T>(
  pool: Pool,
  workspace: string | null,
  operation: (client: PoolClient) => Promise<T>,
  role = "builder_runtime",
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Role comes exclusively from these hard-coded test constants, never input.
    assert.ok(["builder_runtime", "builder_maintenance"].includes(role));
    await client.query(`SET LOCAL ROLE ${role}`);
    if (workspace)
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspace]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function rejectsCode(operation: () => Promise<unknown>, code = "23514") {
  await assert.rejects(operation, (error: unknown) => (error as { code?: string }).code === code);
}

test("PostgreSQL 15 migrations, relational integrity, lifecycle, isolation and query paths", async (t) => {
  const empty = await database();
  const pool = await database();
  let oldFolder: string | undefined;
  try {
    await t.test("clean install and idempotent migration rerun", async () => {
      await migrate(drizzle(empty), { migrationsFolder });
      const first = await empty.query("SELECT count(*) FROM drizzle.__drizzle_migrations");
      await migrate(drizzle(empty), { migrationsFolder });
      assert.equal(
        (await empty.query("SELECT count(*) FROM drizzle.__drizzle_migrations")).rows[0].count,
        first.rows[0].count,
      );
      const journal = JSON.parse(
        await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
      );
      assert.equal(Number(first.rows[0].count), journal.entries.length);
      assert.equal(
        (await empty.query("SELECT count(*) FROM builder.field_types")).rows[0].count,
        "13",
      );
    });

    const legacyUser = randomUUID(),
      legacyForm = randomUUID(),
      legacyField = randomUUID(),
      legacyResponse = randomUUID();
    let legacyBefore: unknown;
    await t.test("upgrade preserves legacy payloads and creates reviewable drafts", async () => {
      oldFolder = await mkdtemp(path.join(tmpdir(), "fb-migrations-"));
      await mkdir(path.join(oldFolder, "meta"));
      const journal = JSON.parse(
        await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
      );
      journal.entries = journal.entries.slice(0, 2);
      await writeFile(path.join(oldFolder, "meta/_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries)
        await copyFile(
          path.join(migrationsFolder, `${entry.tag}.sql`),
          path.join(oldFolder, `${entry.tag}.sql`),
        );
      await migrate(drizzle(pool), { migrationsFolder: oldFolder });
      await pool.query(
        "INSERT INTO public.users (id, full_name, email) VALUES ($1, 'Legacy Owner', 'Legacy@Example.invalid')",
        [legacyUser],
      );
      await pool.query(
        "INSERT INTO public.forms (id, owner_id, title, slug, status) VALUES ($1,$2,'Legacy form','legacy-survey','PUBLISHED')",
        [legacyForm, legacyUser],
      );
      await pool.query(
        "INSERT INTO public.form_fields (id, form_id, key, type, label, config) VALUES ($1,$2,'choice','SINGLE_SELECT','Legacy choice', '{\"options\":[\"Yes\",\"No\"]}')",
        [legacyField, legacyForm],
      );
      await pool.query(
        "INSERT INTO public.form_responses (id,form_id,answers_snapshot,submitted_at) VALUES ($1,$2,'{\"deleted_key\":{\"unmapped\":true}}','2025-01-01 12:00:00')",
        [legacyResponse, legacyForm],
      );
      await pool.query(
        "INSERT INTO public.form_response_answers (response_id,field_key,value) VALUES ($1,'deleted_key','{\"unmapped\":true}')",
        [legacyResponse],
      );
      legacyBefore = (
        await pool.query("SELECT row_to_json(r) AS payload FROM public.form_responses r")
      ).rows;
      await migrate(drizzle(pool), { migrationsFolder });
      assert.deepEqual(
        (await pool.query("SELECT row_to_json(r) AS payload FROM public.form_responses r")).rows,
        legacyBefore,
      );
      assert.equal(
        (await pool.query("SELECT value FROM public.form_response_answers")).rows[0].value.unmapped,
        true,
      );
      assert.equal(
        (
          await pool.query("SELECT status FROM builder.form_versions WHERE form_id=$1", [
            legacyForm,
          ])
        ).rows[0].status,
        "DRAFT",
      );
      assert.equal(
        (
          await pool.query("SELECT published_version_id FROM builder.forms WHERE id=$1", [
            legacyForm,
          ])
        ).rows[0].published_version_id,
        null,
      );
      assert.equal(
        (await pool.query("SELECT count(*) FROM builder.form_submissions")).rows[0].count,
        "0",
      );
      assert.equal(
        (await pool.query("SELECT count(*) FROM builder.field_options")).rows[0].count,
        "2",
      );
      assert.equal(
        (await pool.query("SELECT email FROM public.users WHERE id=$1", [legacyUser])).rows[0]
          .email,
        "legacy@example.invalid",
      );
    });

    const user = randomUUID(),
      w1 = randomUUID(),
      w2 = randomUUID();
    await pool.query(
      "INSERT INTO public.users (id,full_name,email) VALUES ($1,'Test Owner','owner@example.invalid')",
      [user],
    );
    await pool.query(
      "INSERT INTO builder.workspaces (id,owner_user_id,name,slug,retention_days) VALUES ($1,$3,'One','one',30),($2,$3,'Two','two',NULL)",
      [w1, w2, user],
    );
    const form = randomUUID(),
      version = randomUUID(),
      step = randomUUID();
    const textField = randomUUID(),
      numberField = randomUUID(),
      choiceField = randomUUID(),
      fileField = randomUUID(),
      boolField = randomUUID(),
      dateField = randomUUID(),
      jsonField = randomUUID();
    const option1 = randomUUID(),
      option2 = randomUUID();
    await transaction(pool, w1, async (c) => {
      await c.query("INSERT INTO builder.forms (id,workspace_id,slug) VALUES ($1,$2,'survey')", [
        form,
        w1,
      ]);
      await c.query(
        "INSERT INTO builder.form_versions (id,workspace_id,form_id,version_number,title) VALUES ($1,$2,$3,1,'Survey')",
        [version, w1, form],
      );
      await c.query(
        "INSERT INTO builder.form_steps (id,workspace_id,version_id,key,position) VALUES ($1,$2,$3,'main',0)",
        [step, w1, version],
      );
      for (const [position, [id, key, type]] of [
        [textField, "name", "SHORT_TEXT"],
        [numberField, "score", "NUMBER"],
        [choiceField, "choice", "SINGLE_SELECT"],
        [fileField, "upload", "FILE"],
        [boolField, "consent", "CHECKBOX"],
        [dateField, "day", "DATE"],
        [jsonField, "data", "STRUCTURED"],
      ].entries()) {
        await c.query(
          "INSERT INTO builder.form_fields (id,workspace_id,version_id,step_id,key,type_code,label,position) VALUES ($1,$2,$3,$4,$5::text,$6,$5::text,$7)",
          [id, w1, version, step, key, type, position],
        );
      }
      await c.query(
        "INSERT INTO builder.field_options (id,workspace_id,version_id,field_id,key,label,position) VALUES ($1,$3,$4,$5,'yes','Yes',0),($2,$3,$4,$5,'no','No',1)",
        [option1, option2, w1, version, choiceField],
      );
    });

    await t.test(
      "forced RLS denies absent/wrong context, global identity and registry writes",
      async () => {
        assert.equal(
          await transaction(
            pool,
            null,
            async (c) => (await c.query("SELECT * FROM builder.forms")).rowCount,
          ),
          0,
        );
        assert.equal(
          await transaction(
            pool,
            w2,
            async (c) => (await c.query("SELECT * FROM builder.forms")).rowCount,
          ),
          0,
        );
        assert.equal(
          await transaction(
            pool,
            w1,
            async (c) => (await c.query("SELECT * FROM builder.forms")).rowCount,
          ),
          1,
        );
        await rejectsCode(
          () =>
            transaction(pool, w2, (c) =>
              c.query("INSERT INTO builder.forms (workspace_id,slug) VALUES ($1,'bad-scope')", [
                w1,
              ]),
            ),
          "42501",
        );
        await rejectsCode(
          () => transaction(pool, w1, (c) => c.query("SELECT * FROM public.users")),
          "42501",
        );
        await rejectsCode(
          () =>
            transaction(pool, w1, (c) =>
              c.query(
                "UPDATE builder.field_types SET storage_kind='NUMBER' WHERE code='SHORT_TEXT'",
              ),
            ),
          "42501",
        );
        await rejectsCode(
          () =>
            transaction(pool, w1, (c) =>
              c.query("UPDATE builder.workspace_audit_events SET action='forged'"),
            ),
          "42501",
        );
        const { rows } = await pool.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='builder' AND c.relname <> 'field_types' AND c.relkind='r'",
        );
        assert.ok(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity));
      },
    );

    await t.test("scope FKs, draft uniqueness, ordering and logic shape", async () => {
      await rejectsCode(
        () =>
          transaction(pool, w1, (c) =>
            c.query(
              "INSERT INTO builder.form_versions (workspace_id,form_id,version_number,title) VALUES ($1,$2,2,'Duplicate draft')",
              [w1, form],
            ),
          ),
        "23505",
      );
      await rejectsCode(
        () =>
          transaction(pool, w1, (c) =>
            c.query(
              "INSERT INTO builder.form_steps (workspace_id,version_id,key,position) VALUES ($1,$2,'duplicate',0)",
              [w1, version],
            ),
          ),
        "23505",
      );
      await rejectsCode(
        () =>
          transaction(pool, w2, (c) =>
            c.query(
              "INSERT INTO builder.form_versions (workspace_id,form_id,version_number,title) VALUES ($1,$2,1,'Wrong tenant')",
              [w2, form],
            ),
          ),
        "23503",
      );
      await rejectsCode(() =>
        transaction(pool, w1, (c) =>
          c.query(
            "INSERT INTO builder.form_logic_rules (workspace_id,version_id,source_field_id,priority,condition,action_kind) VALUES ($1,$2,$3,0,'{\"formatVersion\":1}', 'GO_TO_STEP')",
            [w1, version, textField],
          ),
        ),
      );
      await rejectsCode(() =>
        transaction(pool, w1, (c) =>
          c.query("UPDATE builder.forms SET published_version_id=$1 WHERE id=$2", [version, form]),
        ),
      );
      await rejectsCode(() =>
        transaction(pool, w1, (c) =>
          c.query("UPDATE builder.form_versions SET settings='{\"retentionDays\":0}' WHERE id=$1", [
            version,
          ]),
        ),
      );
      await rejectsCode(() =>
        transaction(pool, w1, (c) =>
          c.query("UPDATE builder.form_fields SET configuration='[]' WHERE id=$1", [textField]),
        ),
      );
      await rejectsCode(() =>
        transaction(pool, w1, (c) =>
          c.query("UPDATE builder.form_fields SET workspace_id=$1 WHERE id=$2", [w2, textField]),
        ),
      );
      await rejectsCode(() =>
        transaction(pool, w1, async (c) => {
          await c.query(
            'INSERT INTO builder.form_logic_rules (workspace_id,version_id,source_field_id,priority,condition,action_kind) VALUES ($1,$2,$3,0,\'{"formatVersion":1,"fieldKey":"missing","operator":"is_answered"}\',\'END_FORM\')',
            [w1, version, textField],
          );
          await c.query(
            "UPDATE builder.form_versions SET status='PUBLISHED',published_at=now() WHERE id=$1",
            [version],
          );
        }),
      );
      await transaction(pool, w1, (c) =>
        c.query(
          'INSERT INTO builder.form_logic_rules (workspace_id,version_id,source_field_id,priority,condition,action_kind,target_step_id) VALUES ($1,$2,$3,0,\'{"formatVersion":1,"fieldKey":"name","operator":"is_answered"}\', \'GO_TO_STEP\',$4)',
          [w1, version, textField, step],
        ),
      );
    });

    await t.test("publication serializes with draft writes and freezes definitions", async () => {
      const a = await pool.connect(),
        b = await pool.connect();
      try {
        for (const c of [a, b]) {
          await c.query("BEGIN");
          await c.query("SET LOCAL ROLE builder_runtime");
          await c.query("SELECT set_config('app.workspace_id',$1,true)", [w1]);
        }
        await a.query("UPDATE builder.form_fields SET label='Name updated' WHERE id=$1", [
          textField,
        ]);
        let published = false;
        const pending = b
          .query(
            "UPDATE builder.form_versions SET status='PUBLISHED',published_at=now() WHERE id=$1",
            [version],
          )
          .then(() => {
            published = true;
          });
        await new Promise((resolve) => setTimeout(resolve, 80));
        assert.equal(published, false);
        await a.query("COMMIT");
        await pending;
        await b.query("COMMIT");
      } finally {
        await a.query("ROLLBACK");
        await b.query("ROLLBACK");
        a.release();
        b.release();
      }
      await transaction(pool, w1, (c) =>
        c.query("UPDATE builder.forms SET published_version_id=$1 WHERE id=$2", [version, form]),
      );
      await rejectsCode(() =>
        transaction(pool, w1, (c) =>
          c.query("UPDATE builder.form_fields SET label='Changed' WHERE id=$1", [textField]),
        ),
      );
      await rejectsCode(() =>
        transaction(pool, w1, (c) =>
          c.query("DELETE FROM builder.field_options WHERE id=$1", [option1]),
        ),
      );
      await rejectsCode(() =>
        transaction(pool, w1, (c) =>
          c.query("UPDATE builder.form_versions SET settings='{}' WHERE id=$1", [version]),
        ),
      );
      await rejectsCode(() =>
        transaction(pool, w1, (c) =>
          c.query("DELETE FROM builder.form_versions WHERE id=$1", [version]),
        ),
      );
    });

    const submission = randomUUID(),
      otherSubmission = randomUUID();
    await transaction(pool, w1, async (c) => {
      await c.query(
        "INSERT INTO builder.form_submissions (id,workspace_id,form_id,version_id,idempotency_key) VALUES ($1,$3,$4,$5,'request-1'),($2,$3,$4,$5,'request-2')",
        [submission, otherSubmission, w1, form, version],
      );
    });
    await t.test("typed answer checks, false/zero values and answer cardinality", async () => {
      const insert = (field: string, kind: string, column: string, value: unknown) =>
        transaction(pool, w1, (c) =>
          c.query(
            `INSERT INTO builder.submission_answers (workspace_id,version_id,submission_id,field_id,storage_kind,${column}) VALUES ($1,$2,$3,$4,$5,$6)`,
            [w1, version, submission, field, kind, value],
          ),
        );
      await rejectsCode(() => insert(numberField, "TEXT", "value_text", "bad"));
      await rejectsCode(() => insert(numberField, "NUMBER", "value_number", "NaN"));
      await rejectsCode(() => insert(dateField, "DATE", "value_date", "infinity"));
      await rejectsCode(() => insert(jsonField, "JSON", "value_json", "null"));
      await insert(numberField, "NUMBER", "value_number", "0");
      await insert(boolField, "BOOLEAN", "value_boolean", false);
      await insert(textField, "TEXT", "value_text", "Alice");
      await rejectsCode(() => insert(textField, "TEXT", "value_text", "Duplicate"), "23505");
      await rejectsCode(() =>
        transaction(pool, w1, (c) =>
          c.query(
            "INSERT INTO builder.submission_answers (workspace_id,version_id,submission_id,field_id,storage_kind) VALUES ($1,$2,$3,$4,'SINGLE_SELECT')",
            [w1, version, submission, choiceField],
          ),
        ),
      );
      const choiceAnswer = randomUUID();
      await rejectsCode(() =>
        transaction(pool, w1, async (c) => {
          await c.query(
            "INSERT INTO builder.submission_answers (id,workspace_id,version_id,submission_id,field_id,storage_kind) VALUES ($1,$2,$3,$4,$5,'SINGLE_SELECT')",
            [choiceAnswer, w1, version, submission, choiceField],
          );
          await c.query(
            "INSERT INTO builder.answer_selections (workspace_id,version_id,answer_id,field_id,option_id) VALUES ($1,$2,$3,$4,$5),($1,$2,$3,$4,$6)",
            [w1, version, choiceAnswer, choiceField, option1, option2],
          );
        }),
      );
      await transaction(pool, w1, async (c) => {
        await c.query(
          "INSERT INTO builder.submission_answers (id,workspace_id,version_id,submission_id,field_id,storage_kind) VALUES ($1,$2,$3,$4,$5,'SINGLE_SELECT')",
          [choiceAnswer, w1, version, submission, choiceField],
        );
        await c.query(
          "INSERT INTO builder.answer_selections (workspace_id,version_id,answer_id,field_id,option_id) VALUES ($1,$2,$3,$4,$5)",
          [w1, version, choiceAnswer, choiceField, option1],
        );
      });
      await rejectsCode(() =>
        transaction(pool, w1, (c) =>
          c.query("DELETE FROM builder.answer_selections WHERE answer_id=$1", [choiceAnswer]),
        ),
      );
      await rejectsCode(
        () =>
          transaction(pool, w1, (c) =>
            c.query(
              "INSERT INTO builder.form_submissions (workspace_id,form_id,version_id,idempotency_key) VALUES ($1,$2,$3,'request-1')",
              [w1, form, version],
            ),
          ),
        "23505",
      );
      const retention = await pool.query(
        "SELECT expires_at-started_at AS duration FROM builder.form_submissions WHERE id=$1",
        [submission],
      );
      assert.equal(retention.rows[0].duration.days, 30);
    });

    await t.test("file links cannot cross submissions and uploads must be ready", async () => {
      const wrongFile = randomUUID(),
        file = randomUUID(),
        answer = randomUUID();
      await transaction(pool, w1, (c) =>
        c.query(
          "INSERT INTO builder.submission_files (id,workspace_id,version_id,submission_id,object_key,original_filename,media_type,byte_count) VALUES ($1::uuid,$2,$3,$4,$1::uuid::text,'a.txt','text/plain',3)",
          [wrongFile, w1, version, otherSubmission],
        ),
      );
      await rejectsCode(
        () =>
          transaction(pool, w1, async (c) => {
            await c.query(
              "INSERT INTO builder.submission_answers (id,workspace_id,version_id,submission_id,field_id,storage_kind) VALUES ($1,$2,$3,$4,$5,'FILE')",
              [answer, w1, version, submission, fileField],
            );
            await c.query(
              "INSERT INTO builder.answer_files (workspace_id,version_id,submission_id,answer_id,file_id) VALUES ($1,$2,$3,$4,$5)",
              [w1, version, submission, answer, wrongFile],
            );
          }),
        "23503",
      );
      await transaction(pool, w1, async (c) => {
        await c.query(
          "INSERT INTO builder.submission_files (id,workspace_id,version_id,submission_id,object_key,original_filename,media_type,byte_count) VALUES ($1::uuid,$2,$3,$4,$1::uuid::text,'b.txt','text/plain',3)",
          [file, w1, version, submission],
        );
        await c.query(
          "INSERT INTO builder.submission_answers (id,workspace_id,version_id,submission_id,field_id,storage_kind) VALUES ($1,$2,$3,$4,$5,'FILE')",
          [answer, w1, version, submission, fileField],
        );
        await c.query(
          "INSERT INTO builder.answer_files (workspace_id,version_id,submission_id,answer_id,file_id) VALUES ($1,$2,$3,$4,$5)",
          [w1, version, submission, answer, file],
        );
      });
      await rejectsCode(() =>
        transaction(pool, w1, (c) =>
          c.query(
            "UPDATE builder.form_submissions SET status='COMPLETED',completed_at=now() WHERE id=$1",
            [submission],
          ),
        ),
      );
      await transaction(pool, w1, (c) =>
        c.query("UPDATE builder.submission_files SET upload_state='READY' WHERE id=$1", [file]),
      );
    });

    await t.test(
      "clearing choice answers cascades their children; expired submissions reject edits",
      async () => {
        await transaction(pool, w1, async (c) => {
          const answer = randomUUID();
          await c.query(
            "INSERT INTO builder.submission_answers (id,workspace_id,version_id,submission_id,field_id,storage_kind) VALUES ($1,$2,$3,$4,$5,'SINGLE_SELECT')",
            [answer, w1, version, otherSubmission, choiceField],
          );
          await c.query(
            "INSERT INTO builder.answer_selections (workspace_id,version_id,answer_id,field_id,option_id) VALUES ($1,$2,$3,$4,$5)",
            [w1, version, answer, choiceField, option1],
          );
          await c.query("DELETE FROM builder.submission_answers WHERE id=$1", [answer]);
        });
        const expired = randomUUID();
        await transaction(pool, w1, (c) =>
          c.query(
            "INSERT INTO builder.form_submissions (id,workspace_id,form_id,version_id,started_at) VALUES ($1,$2,$3,$4,now()-interval '40 days')",
            [expired, w1, form, version],
          ),
        );
        await rejectsCode(() =>
          transaction(pool, w1, (c) =>
            c.query(
              "INSERT INTO builder.submission_answers (workspace_id,version_id,submission_id,field_id,storage_kind,value_text) VALUES ($1,$2,$3,$4,'TEXT','too late')",
              [w1, version, expired, textField],
            ),
          ),
        );
        await rejectsCode(() =>
          transaction(pool, w1, (c) =>
            c.query(
              "UPDATE builder.form_submissions SET status='COMPLETED',completed_at=now() WHERE id=$1",
              [expired],
            ),
          ),
        );
      },
    );

    await t.test("completion waits for answer writes and protects terminal data", async () => {
      const a = await pool.connect(),
        b = await pool.connect();
      try {
        for (const c of [a, b]) {
          await c.query("BEGIN");
          await c.query("SET LOCAL ROLE builder_runtime");
          await c.query("SELECT set_config('app.workspace_id',$1,true)", [w1]);
        }
        await a.query(
          "UPDATE builder.submission_answers SET value_text='Final name' WHERE submission_id=$1 AND field_id=$2",
          [submission, textField],
        );
        let completed = false;
        const pending = b
          .query(
            "UPDATE builder.form_submissions SET status='COMPLETED',completed_at=clock_timestamp() WHERE id=$1",
            [submission],
          )
          .then(() => {
            completed = true;
          });
        await new Promise((resolve) => setTimeout(resolve, 80));
        assert.equal(completed, false);
        await a.query("COMMIT");
        await pending;
        await b.query("COMMIT");
      } finally {
        await a.query("ROLLBACK");
        await b.query("ROLLBACK");
        a.release();
        b.release();
      }
      await rejectsCode(() =>
        transaction(pool, w1, (c) =>
          c.query(
            "UPDATE builder.submission_answers SET value_text='Changed' WHERE submission_id=$1 AND field_id=$2",
            [submission, textField],
          ),
        ),
      );
      await rejectsCode(() =>
        transaction(pool, w1, (c) =>
          c.query(
            "UPDATE builder.form_submissions SET status='IN_PROGRESS',completed_at=NULL WHERE id=$1",
            [submission],
          ),
        ),
      );
      await rejectsCode(
        () =>
          transaction(pool, w1, (c) =>
            c.query("DELETE FROM builder.form_submissions WHERE id=$1", [submission]),
          ),
        "42501",
      );
    });

    await t.test("new drafts and unpublishing preserve pinned response history", async () => {
      const nextVersion = randomUUID(),
        nextStep = randomUUID(),
        nextField = randomUUID();
      await transaction(pool, w1, async (c) => {
        await c.query(
          "INSERT INTO builder.form_versions (id,workspace_id,form_id,version_number,title) VALUES ($1,$2,$3,2,'Next draft')",
          [nextVersion, w1, form],
        );
        await c.query(
          "INSERT INTO builder.form_steps (id,workspace_id,version_id,key,position) VALUES ($1,$2,$3,'main',0)",
          [nextStep, w1, nextVersion],
        );
        await c.query(
          "INSERT INTO builder.form_fields (id,workspace_id,version_id,step_id,key,type_code,label,position) VALUES ($1,$2,$3,$4,'new_name','SHORT_TEXT','New name',0)",
          [nextField, w1, nextVersion, nextStep],
        );
        await c.query("UPDATE builder.forms SET published_version_id=NULL WHERE id=$1", [form]);
      });
      await rejectsCode(
        () =>
          transaction(pool, w1, (c) =>
            c.query(
              "INSERT INTO builder.submission_answers (workspace_id,version_id,submission_id,field_id,storage_kind,value_text) VALUES ($1,$2,$3,$4,'TEXT','wrong version')",
              [w1, nextVersion, otherSubmission, nextField],
            ),
          ),
        "23503",
      );
      await rejectsCode(() =>
        transaction(pool, w1, (c) =>
          c.query(
            "INSERT INTO builder.form_submissions (workspace_id,form_id,version_id) VALUES ($1,$2,$3)",
            [w1, form, version],
          ),
        ),
      );
      await transaction(pool, w1, (c) =>
        c.query(
          "UPDATE builder.form_submissions SET status='COMPLETED',completed_at=now() WHERE id=$1",
          [otherSubmission],
        ),
      );
      assert.equal(
        (
          await pool.query(
            "SELECT f.label,a.value_text FROM builder.submission_answers a JOIN builder.form_fields f ON f.id=a.field_id WHERE a.submission_id=$1 AND a.field_id=$2",
            [submission, textField],
          )
        ).rows[0].label,
        "Name updated",
      );
      await transaction(pool, w1, (c) =>
        c.query("UPDATE builder.forms SET published_version_id=$1 WHERE id=$2", [version, form]),
      );
    });

    await t.test("context helper resets across success, rollback and pooled reuse", async () => {
      await assert.rejects(
        () => withAuthorizedWorkspace(drizzle(pool), w1, async () => undefined),
        /non-owner/,
      );
      const c = await pool.connect();
      try {
        await c.query("SET ROLE builder_runtime");
        const db = drizzle(c);
        const result = await withAuthorizedWorkspace(db, w1, (tx) =>
          tx.execute(sql`SELECT id FROM builder.forms`),
        );
        assert.equal(result.rowCount, 1);
        assert.equal((await c.query("SELECT * FROM builder.forms")).rowCount, 0);
        await assert.rejects(() =>
          withAuthorizedWorkspace(db, w1, async () => {
            throw new Error("rollback");
          }),
        );
        assert.equal((await c.query("SELECT * FROM builder.forms")).rowCount, 0);
        assert.equal(
          (
            await withAuthorizedWorkspace(db, w2, (tx) =>
              tx.execute(sql`SELECT id FROM builder.forms`),
            )
          ).rowCount,
          0,
        );
      } finally {
        await c.query("RESET ROLE");
        c.release();
      }
    });

    await t.test(
      "response cursor uses its index; numeric filtering preserves correctness under RLS",
      async () => {
        await transaction(pool, w1, async (c) => {
          await c.query(
            "INSERT INTO builder.form_submissions (workspace_id,form_id,version_id) SELECT $1,$2,$3 FROM generate_series(1,2000)",
            [w1, form, version],
          );
          await c.query(
            "INSERT INTO builder.submission_answers (workspace_id,version_id,submission_id,field_id,storage_kind,value_number) SELECT $1,$2,id,$3,'NUMBER',row_number() OVER (ORDER BY id) FROM builder.form_submissions WHERE workspace_id=$1 AND (expires_at IS NULL OR expires_at > now()) AND id NOT IN ($4,$5)",
            [w1, version, numberField, submission, otherSubmission],
          );
        });
        await pool.query("ANALYZE builder.form_submissions");
        await pool.query("ANALYZE builder.submission_answers");
        const page = await transaction(pool, w1, (c) =>
          c.query(
            "EXPLAIN (ANALYZE,FORMAT JSON) SELECT id FROM builder.form_submissions WHERE workspace_id=$1 AND form_id=$2 AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 25",
            [w1, form],
          ),
        );
        const numeric = await transaction(pool, w1, (c) =>
          c.query(
            "EXPLAIN (ANALYZE,FORMAT JSON) SELECT submission_id FROM builder.submission_answers WHERE workspace_id=$1 AND field_id=$2 AND value_number BETWEEN 100 AND 105",
            [w1, numberField],
          ),
        );
        assert.match(JSON.stringify(page.rows), /submissions_page_idx/);
        // PostgreSQL 15 numeric comparisons are not leakproof: RLS can prevent
        // range index conditions. Do not disable RLS or alter system functions.
        const numericRows = await transaction(pool, w1, (c) =>
          c.query(
            "SELECT value_number FROM builder.submission_answers WHERE workspace_id=$1 AND field_id=$2 AND value_number BETWEEN 100 AND 105",
            [w1, numberField],
          ),
        );
        assert.equal(numericRows.rowCount, 6);
        const privilegedNumeric = await pool.query(
          "EXPLAIN (ANALYZE,FORMAT JSON) SELECT submission_id FROM builder.submission_answers WHERE workspace_id=$1 AND field_id=$2 AND value_number BETWEEN 100 AND 105",
          [w1, numberField],
        );
        assert.match(JSON.stringify(privilegedNumeric.rows), /answers_numeric_idx/);
        t.diagnostic(
          `Runtime numeric plan: ${numeric.rows[0]["QUERY PLAN"][0].Plan.Plans?.[0]?.["Node Type"] ?? numeric.rows[0]["QUERY PLAN"][0].Plan["Node Type"]}; numeric range index verified separately on privileged connection.`,
        );
      },
    );

    await t.test(
      "maintenance purge cascades only submission data and audits deletion",
      async () => {
        await transaction(
          pool,
          w1,
          (c) => c.query("DELETE FROM builder.form_submissions WHERE id=$1", [submission]),
          "builder_maintenance",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*) FROM builder.submission_answers WHERE submission_id=$1",
              [submission],
            )
          ).rows[0].count,
          "0",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*) FROM builder.submission_files WHERE submission_id=$1",
              [submission],
            )
          ).rows[0].count,
          "0",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*) FROM builder.workspace_audit_events WHERE entity_id=$1 AND action='form_submissions.delete'",
              [submission],
            )
          ).rows[0].count,
          "1",
        );
        assert.equal(
          (await pool.query("SELECT count(*) FROM builder.form_versions WHERE id=$1", [version]))
            .rows[0].count,
          "1",
        );
        await rejectsCode(
          () => pool.query("DELETE FROM public.users WHERE id=$1", [user]),
          "23503",
        );
        assert.deepEqual(
          (await pool.query("SELECT row_to_json(r) AS payload FROM public.form_responses r")).rows,
          legacyBefore,
        );
      },
    );

    await t.test(
      "duplicate legacy identities stop upgrade with actionable diagnostics",
      async () => {
        const conflicting = await database();
        try {
          await migrate(drizzle(conflicting), { migrationsFolder: oldFolder! });
          await conflicting.query(
            "INSERT INTO public.users (full_name,email) VALUES ('One','same@example.invalid'),('Two','SAME@example.invalid')",
          );
          await assert.rejects(
            () => migrate(drizzle(conflicting), { migrationsFolder }),
            (error: unknown) =>
              /Duplicate normalized user emails/.test(
                String((error as { cause?: unknown }).cause ?? error),
              ),
          );
          assert.equal(
            (await conflicting.query("SELECT count(*) FROM public.users")).rows[0].count,
            "2",
          );
        } finally {
          await conflicting.end();
        }
      },
    );
  } finally {
    await empty.end();
    await pool.end();
    if (oldFolder) await rm(oldFolder, { recursive: true, force: true });
    for (const name of ownedDatabases) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
