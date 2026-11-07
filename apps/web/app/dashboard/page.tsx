import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";
import { createServerApi } from "~/trpc/server";

async function AccountOverview() {
  await auth.protect();
  const api = await createServerApi();
  const user = await api.auth.me.query();
  return (
    <section className="space-y-3" aria-labelledby="account-heading" data-testid="account-overview">
      <h1 id="account-heading" className="text-3xl font-semibold">
        Welcome, {user.fullName}
      </h1>
      <p>{user.email}</p>
      <p className="text-muted-foreground">Your Sumikami account is connected.</p>
    </section>
  );
}

export default function Dashboard() {
  return (
    <main className="mx-auto min-h-screen max-w-4xl space-y-12 px-6 py-10">
      <header className="flex items-center justify-between">
        <Link href="/">Sumikami</Link>
        <UserButton />
      </header>
      <Suspense fallback={<p>Loading your account…</p>}>
        <AccountOverview />
      </Suspense>
    </main>
  );
}
