import { zodUndefinedModel } from "../../schema";
import { protectedProcedure, router } from "../../trpc";
import { userPublicSchema } from "@repo/services/auth/model";

// Clerk owns sign-in/up/out. Legacy cookie endpoints are not registered here.
export const authRouter = router({
  me: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/authentication/me",
        tags: ["Authentication"],
        protect: true,
      },
    })
    .input(zodUndefinedModel)
    .output(userPublicSchema)
    .query(({ ctx }) => ctx.user),
});
