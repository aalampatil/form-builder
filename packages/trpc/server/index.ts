import { router } from "./trpc";
import { publicProcedure } from "./trpc";
import { z } from "zod";
import { healthRouter } from "./routes/health/route";
import { authRouter } from "./routes/auth/route";
import { publicRouter } from "./routes/public/route";

export const serverRouter = router({
  health: healthRouter,
  auth: authRouter,
  public: publicRouter,
  test: publicProcedure
    .input(z.object({ email: z.email() }))
    .output(z.object({ message: z.string() }))
    .query(async ({ input }) => {
      return { message: `hello ${input.email}` };
    }),
});

export { createContext } from "./context";
export type ServerRouter = typeof serverRouter;
