import { z } from "../../schema";
import { formsService, responsesService } from "../../services";
import { publicProcedure, router, TRPCError } from "../../trpc";
import { generatePath } from "../../utils/path-generator";
import { enforceRateLimit } from "../../utils/rate-limit";
import { submitResponseInputSchema, submitResponseOutputSchema } from "@repo/services/responses/model";
import { publicFormSchema } from "@repo/services/forms/model";
import { ZodError } from "zod";

const TAGS = ["Public Forms"];
const getPath = generatePath("/public");

export const publicRouter = router({
  getForm: publicProcedure
    .meta({ openapi: { method: "GET", path: getPath("/forms/get"), tags: TAGS } })
    .input(z.object({ slug: z.string().min(3).max(120) }))
    .output(publicFormSchema)
    .query(async ({ input }) => {
      const found = await formsService.getPublicFormBySlug(input.slug);
      if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });

      const { form, fields } = found;
      if (form.status !== "PUBLISHED") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Form is not published" });
      }

      return {
        id: form.id,
        slug: form.slug,
        title: form.title,
        description: form.description ?? null,
        visibility: form.visibility,
        status: form.status,
        themeId: form.themeId ?? null,
        settings: (form.settings ?? {}) as Record<string, unknown>,
        fields: fields.map((f) => ({
          key: f.key,
          type: f.type,
          label: f.label,
          helpText: f.helpText ?? null,
          placeholder: f.placeholder ?? null,
          required: f.required ?? false,
          order: f.order ?? 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          config: (f.config ?? {}) as any,
        })),
      };
    }),

  submitResponse: publicProcedure
    .meta({ openapi: { method: "POST", path: getPath("/forms/submit"), tags: TAGS } })
    .input(submitResponseInputSchema)
    .output(submitResponseOutputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.honeypot) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid submission" });
      }

      const ip = ctx.req.ip ?? ctx.req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ?? null;
      const rlKey = `submit:${input.slug}:${ip ?? "unknown"}`;
      const rl = enforceRateLimit({ key: rlKey, limit: 20, windowMs: 60_000 });
      if (!rl.ok) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Rate limit exceeded. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s`,
        });
      }

      try {
        const out = await responsesService.submitPublicResponse({
          slug: input.slug,
          answers: input.answers,
          respondentEmail: input.respondentEmail ?? null,
          receiveEmailCopy: input.receiveEmailCopy,
          ip,
          userAgent: ctx.req.headers["user-agent"],
          formPassword: input.formPassword ?? null,
        });
        return out;
      } catch (err: unknown) {
        if (err instanceof ZodError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid answers" });
        }
        const code = err instanceof Error ? err.message : "SUBMIT_FAILED";
        switch (code) {
          case "FORM_NOT_FOUND":
          case "FORM_UNPUBLISHED":
            throw new TRPCError({ code: "NOT_FOUND", message: "Form not available" });
          case "FORM_EXPIRED":
            throw new TRPCError({ code: "BAD_REQUEST", message: "Form has expired" });
          case "RESPONSE_LIMIT_REACHED":
            throw new TRPCError({ code: "BAD_REQUEST", message: "Response limit reached" });
          case "DUPLICATE_SUBMISSION":
            throw new TRPCError({ code: "CONFLICT", message: "You already submitted this form" });
          case "FORM_PASSWORD_REQUIRED":
            throw new TRPCError({ code: "UNAUTHORIZED", message: "Password required" });
          default:
            throw new TRPCError({ code: "BAD_REQUEST", message: "Submission failed" });
        }
      }
    }),
});
