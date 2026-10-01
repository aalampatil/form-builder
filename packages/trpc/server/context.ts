import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { authService } from "./services";
import { parseCookies } from "./utils/cookies";

export const SESSION_COOKIE_NAME = "fb_session";

export async function createContext(opts: CreateExpressContextOptions) {
  const cookies = parseCookies(opts.req.headers);
  const token = cookies[SESSION_COOKIE_NAME];

  const session = token ? await authService.getSessionByToken(token) : null;

  return {
    req: opts.req,
    res: opts.res,
    user: session?.user ?? null,
    sessionToken: token ?? null,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
