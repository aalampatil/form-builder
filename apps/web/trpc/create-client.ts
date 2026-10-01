import { httpLink, httpBatchStreamLink } from "@repo/trpc/client";
import { env } from "~/env.js";

interface CreateTRPCHttpBatchClientClientOpts {
  enableStreaming?: boolean;
}

export const createTRPCHttpBatchClientClient = (opts?: CreateTRPCHttpBatchClientClientOpts) => {
  const c = opts?.enableStreaming ? httpBatchStreamLink : httpLink;

  const rawUrl =
    typeof window === "undefined"
      ? // Node/SSR needs an absolute URL
        (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/trpc")
      : // Browser can use same-origin if NEXT_PUBLIC_API_URL is not set
        (env.NEXT_PUBLIC_API_URL ?? "/trpc");

  const url =
    typeof window === "undefined"
      ? rawUrl
      : rawUrl.startsWith("/")
        ? `${window.location.origin}${rawUrl}`
        : rawUrl;

  return c({
    url,
    fetch(url, options) {
      return fetch(url, {
        ...options,
        credentials: "include",
      });
    },
  });
};
