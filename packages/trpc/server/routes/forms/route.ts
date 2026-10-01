import { z } from "../../schema";
import { formsService } from "../../services";
import { protectedProcedure, router, TRPCError } from "../../trpc";
import { generatePath } from "../../utils/path-generator";
import {
  createFormInputSchema,
  publishFormInputSchema,
  updateFormInputSchema,
  upsertFieldsInputSchema,
} from "@repo/services/forms/model";

const TAGS = ["Forms"];
const getPath = generatePath("/forms");

const formRecordSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable().optional(),
  slug: z.string(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  visibility: z.enum(["PUBLIC", "UNLISTED"]),
  themeId: z.string().uuid().nullable().optional(),
  settings: z.any(),
  publishedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date().nullable().optional(),
});

const fieldRecordSchema = z.object({
  id: z.string().uuid(),
  formId: z.string().uuid(),
  key: z.string(),
  type: z.enum([
    "SHORT_TEXT",
    "LONG_TEXT",
    "EMAIL",
    "NUMBER",
    "SINGLE_SELECT",
    "MULTI_SELECT",
    "DROPDOWN",
    "CHECKBOX",
    "RATING",
    "DATE",
  ]),
  label: z.string(),
  helpText: z.string().nullable().optional(),
  placeholder: z.string().nullable().optional(),
  required: z.boolean(),
  order: z.number().int(),
  config: z.any(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date().nullable().optional(),
});

export const formsRouter = router({
  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/"), tags: TAGS } })
    .input(z.undefined())
    .output(z.array(formRecordSchema))
    .query(async ({ ctx }) => formsService.listForms(ctx.user.id)),

  get: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/get"), tags: TAGS } })
    .input(z.object({ formId: z.string().uuid() }))
    .output(z.object({ form: formRecordSchema, fields: z.array(fieldRecordSchema) }))
    .query(async ({ ctx, input }) => {
      const found = await formsService.getFormWithFieldsById(ctx.user.id, input.formId);
      if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
      return found;
    }),

  create: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/"), tags: TAGS } })
    .input(createFormInputSchema)
    .output(formRecordSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await formsService.createForm(ctx.user.id, input);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to create form";
        if (message.toLowerCase().includes("unique")) {
          throw new TRPCError({ code: "CONFLICT", message: "Slug already in use" });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
    }),

  update: protectedProcedure
    .meta({ openapi: { method: "PUT", path: getPath("/"), tags: TAGS } })
    .input(updateFormInputSchema)
    .output(formRecordSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const updated = await formsService.updateForm(ctx.user.id, input);
        if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
        return updated;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to update form";
        if (message.toLowerCase().includes("unique")) {
          throw new TRPCError({ code: "CONFLICT", message: "Slug already in use" });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
    }),

  publish: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/publish"), tags: TAGS } })
    .input(publishFormInputSchema)
    .output(formRecordSchema)
    .mutation(async ({ ctx, input }) => {
      const updated = await formsService.setPublished(ctx.user.id, input.formId, input.publish);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
      return updated;
    }),

  archive: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/archive"), tags: TAGS } })
    .input(z.object({ formId: z.string().uuid() }))
    .output(formRecordSchema)
    .mutation(async ({ ctx, input }) => {
      const updated = await formsService.archive(ctx.user.id, input.formId);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
      return updated;
    }),

  upsertFields: protectedProcedure
    .meta({ openapi: { method: "PUT", path: getPath("/fields"), tags: TAGS } })
    .input(upsertFieldsInputSchema)
    .output(z.object({ form: formRecordSchema, fields: z.array(fieldRecordSchema) }))
    .mutation(async ({ ctx, input }) => {
      const updated = await formsService.upsertFields(ctx.user.id, input.formId, input.fields);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
      return updated;
    }),
});
