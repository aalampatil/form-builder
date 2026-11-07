import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-12">
      <div>
        <p className="mb-3 text-sm text-muted-foreground">INK MEETS INTERACTION</p>
        <h1 className="text-5xl font-semibold">Sumikami</h1>
        <p className="mt-4 text-xl">Make every question an experience.</p>
      </div>
      <Suspense fallback={<p>Loading account controls…</p>}>
        <Show
          when="signed-in"
          fallback={
            <div className="flex gap-4">
              <SignInButton mode="redirect">
                <button className="rounded-md border px-5 py-3">Sign in</button>
              </SignInButton>
              <SignUpButton mode="redirect">
                <button className="rounded-md bg-primary px-5 py-3 text-primary-foreground">
                  Create account
                </button>
              </SignUpButton>
            </div>
          }
        >
          <div className="flex items-center gap-5">
            <Link
              href="/dashboard"
              className="rounded-md bg-primary px-5 py-3 text-primary-foreground"
            >
              Open dashboard
            </Link>
            <UserButton />
          </div>
        </Show>
      </Suspense>
    </main>
  );
}
