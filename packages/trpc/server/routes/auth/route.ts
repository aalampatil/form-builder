import { z, zodUndefinedModel } from "../../schema";
import { authService, userService } from "../../services";
import { getAuthenticationMethodOutputSchema } from "@repo/services/user/model";
import { TRPCError, protectedProcedure, publicProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";
import { signInInputSchema, signUpInputSchema, userPublicSchema } from "@repo/services/auth/model";
import { SESSION_COOKIE_NAME } from "../../context";

const TAGS = ["Authentication"];
const getPath = generatePath("/authentication");

export const authRouter = router({
  me: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/me"), tags: TAGS } })
    .input(zodUndefinedModel)
    .output(userPublicSchema)
    .query(async ({ ctx }) => ctx.user),

  signUp: publicProcedure
    .meta({ openapi: { method: "POST", path: getPath("/sign-up"), tags: TAGS } })
    .input(signUpInputSchema)
    .output(userPublicSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const user = await authService.signUp(input);
        const session = await authService.createSession({
          userId: user.id,
          ip: ctx.req.ip,
          userAgent: ctx.req.headers["user-agent"],
        });

        ctx.res.cookie(SESSION_COOKIE_NAME, session.token, {
          httpOnly: true,
          sameSite: "lax",
          secure: ctx.req.secure || ctx.req.headers["x-forwarded-proto"] === "https",
          expires: session.expiresAt,
          path: "/",
        });

        return user;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to sign up";
        if (message.toLowerCase().includes("unique")) {
          throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
    }),

  signIn: publicProcedure
    .meta({ openapi: { method: "POST", path: getPath("/sign-in"), tags: TAGS } })
    .input(signInInputSchema)
    .output(userPublicSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const user = await authService.signIn(input);
        const session = await authService.createSession({
          userId: user.id,
          ip: ctx.req.ip,
          userAgent: ctx.req.headers["user-agent"],
        });

        ctx.res.cookie(SESSION_COOKIE_NAME, session.token, {
          httpOnly: true,
          sameSite: "lax",
          secure: ctx.req.secure || ctx.req.headers["x-forwarded-proto"] === "https",
          expires: session.expiresAt,
          path: "/",
        });

        return user;
      } catch {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
      }
    }),

  signOut: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/sign-out"), tags: TAGS } })
    .input(zodUndefinedModel)
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx }) => {
      if (ctx.sessionToken) {
        await authService.revokeSession(ctx.sessionToken);
      }

      ctx.res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      return { ok: true };
    }),

  getSupportedAuthenticationProviders: publicProcedure
    .meta({ openapi: { method: "GET", path: getPath("/supported-providers"), tags: TAGS } })
    .input(zodUndefinedModel)
    .output(z.readonly(z.array(getAuthenticationMethodOutputSchema)))
    .query(async () => {
      const supportedMethods = await userService.getAuthenticationMethods();
      return supportedMethods;
    }),
});
