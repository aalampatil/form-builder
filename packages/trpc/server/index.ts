import { router } from "./trpc";
import { publicProcedure } from "./trpc";
import { z } from "zod";
import { healthRouter } from "./routes/health/route";
import { authRouter } from "./routes/auth/route";
import { formsRouter } from "./routes/forms/route";
import { publicRouter } from "./routes/public/route";
import { responsesRouter } from "./routes/responses/route";

// @ts-nocheck
export const serverRouter = router({
  health: healthRouter,
  auth: authRouter,
  forms: formsRouter,
  public: publicRouter,
  responses: responsesRouter,
  test: publicProcedure
    .input(z.object({ email: z.email() }))
    .output(z.object({ message: z.string() }))
    .query(async ({ input }) => {
      return { message: `hello ${input.email}` };
    }),
});

export { createContext } from "./context";
export type ServerRouter = typeof serverRouter;
