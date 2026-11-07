import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import type { ClerkProfile } from "./clerk";

test("Clerk identities preserve local ownership and reject unsafe linking", async (t) => {
  const target = process.env.TEST_DATABASE_URL;
  if (
    !target ||
    !/_(test)$/.test(new URL(target).pathname) ||
    !["localhost", "127.0.0.1"].includes(new URL(target).hostname)
  ) {
    throw new Error("Auth integration tests require a local TEST_DATABASE_URL ending in _test");
  }
  const admin = new Pool({ connectionString: target });
  const name = `clerk_${randomUUID().replaceAll("-", "")}_test`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(target);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString() });
  process.env.DATABASE_URL = url.toString();
  const { ClerkIdentityService, IdentityAccessError } = await import("./clerk");
  const { db } = await import("@repo/database");
  function profile(id: string, email: string, extra: Partial<ClerkProfile> = {}): ClerkProfile {
    return {
      id,
      externalId: null,
      primaryEmailAddressId: "email_1",
      firstName: "Clerk",
      lastName: "Fixture",
      imageUrl: "",
      banned: false,
      locked: false,
      emailAddresses: [
        { id: "email_1", emailAddress: email, verification: { status: "verified" } },
      ] as ClerkProfile["emailAddresses"],
      ...extra,
    };
  }
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: path.resolve(__dirname, "../../database/drizzle"),
    });
    await t.test("first requests are idempotent and never inherit an elevated role", async () => {
      const service = new ClerkIdentityService(async (id) => profile(id, "new@example.invalid"));
      const results = await Promise.all(
        Array.from({ length: 8 }, () => service.resolveUser("user_concurrent")),
      );
      assert.ok(
        results.every((result) => result.id === results[0]!.id && result.role === "CREATOR"),
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM public.users WHERE clerk_user_id='user_concurrent'",
          )
        ).rows[0].count,
        "1",
      );
      const cached = new ClerkIdentityService(async () => {
        throw new Error("Existing users need no profile lookup");
      });
      assert.equal((await cached.resolveUser("user_concurrent")).id, results[0]!.id);
    });
    await t.test(
      "legacy email collisions and external IDs cannot silently take over an account",
      async () => {
        const localId = randomUUID();
        await pool.query(
          "INSERT INTO public.users (id,full_name,email,password_hash,role) VALUES ($1,'Legacy owner','legacy@example.invalid','preserved_digest','ADMIN')",
          [localId],
        );
        await pool.query(
          "INSERT INTO builder.workspaces (owner_user_id,name,slug) VALUES ($1,'Legacy workspace','legacy-workspace')",
          [localId],
        );
        for (const externalId of [null, localId]) {
          const service = new ClerkIdentityService(async (id) =>
            profile(id, "legacy@example.invalid", { externalId }),
          );
          await assert.rejects(
            () => service.resolveUser("user_legacy"),
            (error: unknown) =>
              error instanceof IdentityAccessError && error.reason === "ACCOUNT_LINK_REQUIRED",
          );
        }
        assert.equal(
          (await pool.query("SELECT clerk_user_id FROM public.users WHERE id=$1", [localId]))
            .rows[0].clerk_user_id,
          null,
        );
        // Model a separately reviewed import's persisted mapping, not automatic email linking.
        await pool.query("UPDATE public.users SET clerk_user_id='user_legacy' WHERE id=$1", [
          localId,
        ]);
        const service = new ClerkIdentityService(async () => {
          throw new Error("Mapped identity must not be recreated");
        });
        const resolved = await service.resolveUser("user_legacy");
        assert.equal(resolved.id, localId);
        assert.equal(resolved.role, "ADMIN");
        assert.equal(
          (
            await pool.query(
              "SELECT owner_user_id FROM builder.workspaces WHERE slug='legacy-workspace'",
            )
          ).rows[0].owner_user_id,
          localId,
        );
        assert.equal(
          (await pool.query("SELECT password_hash FROM public.users WHERE id=$1", [localId]))
            .rows[0].password_hash,
          "preserved_digest",
        );
      },
    );
    await t.test("local deletion, remote lock and missing primary email deny access", async () => {
      await pool.query(
        "UPDATE public.users SET deleted_at=now() WHERE clerk_user_id='user_concurrent'",
      );
      const service = new ClerkIdentityService(async (id) => profile(id, "other@example.invalid"));
      await assert.rejects(() => service.resolveUser("user_concurrent"), /ACCOUNT_DISABLED/);
      for (const extra of [{ banned: true }, { locked: true }, { id: "user_wrong" }]) {
        const blocked = new ClerkIdentityService(async (id) =>
          profile(id, "blocked@example.invalid", extra),
        );
        await assert.rejects(() => blocked.resolveUser("user_blocked"), /ACCOUNT_DISABLED/);
      }
      const missing = new ClerkIdentityService(async (id) =>
        profile(id, "missing@example.invalid", { primaryEmailAddressId: null }),
      );
      await assert.rejects(() => missing.resolveUser("user_no_email"), /EMAIL_REQUIRED/);
    });
    await t.test(
      "unverified email stays unverified and long display names are bounded",
      async () => {
        const remote = profile("user_unverified", "unverified@example.invalid", {
          firstName: "x".repeat(120),
          emailAddresses: [
            {
              id: "email_1",
              emailAddress: "unverified@example.invalid",
              verification: { status: "unverified" },
            },
          ] as ClerkProfile["emailAddresses"],
        });
        await new ClerkIdentityService(async () => remote).resolveUser(remote.id);
        const result = (
          await pool.query(
            "SELECT email_verified,length(full_name) AS length FROM public.users WHERE clerk_user_id=$1",
            [remote.id],
          )
        ).rows[0];
        assert.equal(result.email_verified, false);
        assert.equal(result.length, 80);
      },
    );
  } finally {
    await db.$client.end();
    await pool.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
