import { createClerkClient } from "@clerk/backend";
import { and, db, eq, isNull } from "@repo/database";
import { usersTable } from "@repo/database/schema";

const bcryptDigest = /^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/;

async function retryRateLimit<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const failure = error as { status?: number; retryAfter?: number };
      if (failure.status !== 429 || attempt >= 4) throw error;
      const seconds = failure.retryAfter ?? 2 ** attempt;
      if (seconds > 30)
        throw new Error(
          "Clerk rate limit requires a longer pause; rerun the resumable importer later.",
        );
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, seconds) * 1000));
    }
  }
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  if ([...flags].some((flag) => !["--apply", "--allow-production"].includes(flag))) {
    throw new Error("Usage: auth:import:clerk [--apply] [--allow-production]");
  }
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY must be set in this server process.");
  const database = new URL(process.env.DATABASE_URL!);
  const development = secretKey.startsWith("sk_test_");
  if (development) {
    if (flags.has("--allow-production"))
      throw new Error("Production import cannot target a development Clerk instance.");
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) ||
      !/_(dev|test)$/.test(database.pathname)
    ) {
      throw new Error(
        "Development imports require a local disposable _dev/_test database. Production users must not enter accountless development instances.",
      );
    }
  } else if (!secretKey.startsWith("sk_live_") || !flags.has("--allow-production")) {
    throw new Error(
      "Live imports require an explicitly selected live instance and --allow-production.",
    );
  }
  const users = await db
    .select()
    .from(usersTable)
    .where(and(isNull(usersTable.deletedAt), isNull(usersTable.clerkUserId)));
  const unsupported = users.filter(
    (user) => !user.passwordHash || !bcryptDigest.test(user.passwordHash),
  );
  console.log(
    JSON.stringify({
      mode: flags.has("--apply") ? "apply" : "dry-run",
      target: development ? "development" : "production",
      candidates: users.length,
      compatiblePasswords: users.length - unsupported.length,
      recoveryRequired: unsupported.length,
    }),
  );
  // Dry runs deliberately make no Clerk requests and print no emails or digests.
  if (!flags.has("--apply")) return;
  if (unsupported.length)
    throw new Error(
      "Resolve missing/unsupported credentials with a reviewed recovery/OAuth plan before importing.",
    );
  const clerk = createClerkClient({ secretKey });
  let mapped = 0;
  for (const user of users) {
    const existing = await retryRateLimit(() =>
      clerk.users.getUserList({ externalId: [user.id], limit: 2 }),
    );
    if (existing.data.length > 1)
      throw new Error("Duplicate external identity; reconcile before continuing.");
    let remote = existing.data[0];
    if (!remote) {
      const collision = await retryRateLimit(() =>
        clerk.users.getUserList({ emailAddress: [user.email], limit: 1 }),
      );
      if (collision.data.length)
        throw new Error(
          "An email is already attached to another Clerk identity; reconcile it without automatic linking.",
        );
      remote = await retryRateLimit(() =>
        clerk.users.createUser({
          externalId: user.id,
          emailAddress: [user.email],
          emailAddressIdentificationStatus: [user.emailVerified ? "verified" : "reserved"],
          firstName: user.fullName,
          passwordDigest: user.passwordHash!,
          passwordHasher: "bcrypt",
        }),
      );
    }
    const primary = remote.emailAddresses.find(
      (email) => email.id === remote.primaryEmailAddressId,
    );
    if (remote.externalId !== user.id || primary?.emailAddress.toLowerCase() !== user.email) {
      throw new Error("External identity/email mismatch; import stopped for reconciliation.");
    }
    const result = await db
      .update(usersTable)
      .set({ clerkUserId: remote.id })
      .where(
        and(
          eq(usersTable.id, user.id),
          isNull(usersTable.clerkUserId),
          isNull(usersTable.deletedAt),
        ),
      )
      .returning({ id: usersTable.id });
    if (!result.length) {
      const [current] = await db
        .select({ clerkId: usersTable.clerkUserId, deletedAt: usersTable.deletedAt })
        .from(usersTable)
        .where(eq(usersTable.id, user.id));
      if (!current || current.deletedAt || current.clerkId !== remote.id)
        throw new Error("Identity changed during import; inspect before resuming.");
    }
    mapped++;
  }
  console.log(JSON.stringify({ mapped, complete: true }));
}

main()
  .catch(() => {
    // SDK errors can contain user data. Keep exports/digests out of command output.
    console.error(
      "Clerk import failed. Reconcile the candidate configuration/identities and retry; no credentials were logged.",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
