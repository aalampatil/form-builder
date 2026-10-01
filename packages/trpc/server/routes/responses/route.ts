import { z } from "../../schema";
import { responsesService } from "../../services";
import { protectedProcedure, router, TRPCError } from "../../trpc";
import { generatePath } from "../../utils/path-generator";
import {
  analyticsInputSchema,
  getResponseInputSchema,
  listResponsesInputSchema,
} from "@repo/services/responses/model";

const TAGS = ["Responses"];
const getPath = generatePath("/responses");

const responseRecordSchema = z.object({
  id: z.string().uuid(),
  formId: z.string().uuid(),
  respondentEmail: z.string().nullable().optional(),
  status: z.enum(["COMPLETED", "PARTIAL"]),
  submittedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  answersSnapshot: z.record(z.string(), z.any()),
});

const answerRecordSchema = z.object({
  id: z.string().uuid(),
  responseId: z.string().uuid(),
  fieldKey: z.string(),
  value: z.any(),
  createdAt: z.coerce.date(),
});

export const responsesRouter = router({
  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/list"), tags: TAGS } })
    .input(listResponsesInputSchema)
    .output(z.array(responseRecordSchema))
    .query(async ({ ctx, input }) => {
      const rows = await responsesService.listResponsesForOwner({
        ownerId: ctx.user.id,
        formId: input.formId,
        cursor: input.cursor,
        limit: input.limit,
      });
      if (!rows) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
      return rows as unknown as Array<z.infer<typeof responseRecordSchema>>;
    }),

  get: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/get"), tags: TAGS } })
    .input(getResponseInputSchema)
    .output(z.object({ response: responseRecordSchema, answers: z.array(answerRecordSchema) }))
    .query(async ({ ctx, input }) => {
      const found = await responsesService.getResponseForOwner({
        ownerId: ctx.user.id,
        formId: input.formId,
        responseId: input.responseId,
      });
      if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "Response not found" });
      return found as unknown as {
        response: z.infer<typeof responseRecordSchema>;
        answers: Array<z.infer<typeof answerRecordSchema>>;
      };
    }),

  analytics: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/analytics"), tags: TAGS } })
    .input(analyticsInputSchema)
    .output(
      z.object({
        totalResponses: z.number().int(),
        perField: z.array(
          z.object({
            fieldKey: z.string(),
            type: z.string(),
            counts: z.record(z.string(), z.number().int()).optional(),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const found = await responsesService.getAnalyticsForOwner({
        ownerId: ctx.user.id,
        formId: input.formId,
      });
      if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
      return found;
    }),
});
