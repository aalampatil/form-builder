import "server-only";
import { auth } from "@clerk/nextjs/server";
import type { ServerRouter } from "@repo/trpc/client";
import { createTRPCProxyClient } from "@repo/trpc/client";
import { createTRPCHttpBatchClientClient } from "~/trpc/create-client";

// Create per request: never cache one user's token or API client globally.
export async function createServerApi() {
  const { getToken } = await auth();
  return createTRPCProxyClient<ServerRouter>({
    links: [createTRPCHttpBatchClientClient({ getToken })],
  });
}
