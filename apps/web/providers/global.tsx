"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { useMemo, useState, type ReactNode } from "react";
import { Toaster } from "~/components/ui/sonner";
import { trpc } from "~/trpc/client";
import { createTRPCHttpBatchClientClient } from "~/trpc/create-client";

function UserDataProviders({
  children,
  getToken,
}: {
  children: ReactNode;
  getToken: () => Promise<string | null>;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000 } },
      }),
  );
  const client = useMemo(
    () =>
      trpc.createClient({
        links: [createTRPCHttpBatchClientClient({ getToken })],
      }),
    [getToken],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <trpc.Provider queryClient={queryClient} client={client}>
        {children}
      </trpc.Provider>
    </QueryClientProvider>
  );
}

export function GlobalProviders({ children }: { children: ReactNode }) {
  const { userId, getToken } = useAuth();
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      {/* A different identity gets a new query cache; signed-out users never see cached profile data. */}
      <UserDataProviders key={userId ?? "anonymous"} getToken={getToken}>
        {children}
        <Toaster />
      </UserDataProviders>
    </NextThemesProvider>
  );
}
