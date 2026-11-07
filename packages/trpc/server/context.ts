import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { getAuth } from "@clerk/express";
import { IdentityAccessError } from "@repo/services/auth/clerk";
import { TRPCError } from "@trpc/server";
import { identityService } from "./services";
import type { UserPublic } from "@repo/services/auth/model";

export interface Context {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: UserPublic | null;
}

export async function createContext(opts: CreateExpressContextOptions): Promise<Context> {
  const authentication = getAuth(opts.req);
  let user: UserPublic | null = null;
  if (authentication.isAuthenticated && authentication.userId) {
    try {
      user = await identityService.resolveUser(authentication.userId);
    } catch (error) {
      if (error instanceof IdentityAccessError)
        throw new TRPCError({ code: "FORBIDDEN", message: error.reason });
      throw error;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
