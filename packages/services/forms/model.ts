import { z } from "zod";

export const formVisibilitySchema = z.enum(["PUBLIC", "UNLISTED"]);
export const formStatusSchema = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);

export const fieldTypeSchema = z.enum([
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
]);

export const fieldConfigSchema = z
  .object({
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
    regex: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    options: z.array(z.string().min(1).max(120)).max(200).optional(),
    allowOther: z.boolean().optional(),
    minItems: z.number().int().min(0).optional(),
    maxItems: z.number().int().min(1).optional(),
  })
  .passthrough()
  .default({});

export const upsertFormFieldSchema = z.object({
  id: z.string().uuid().optional(),
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Key must be alphanumeric/underscore and start with a letter"),
  type: fieldTypeSchema,
  label: z.string().min(1).max(160),
  helpText: z.string().max(2000).optional().nullable(),
  placeholder: z.string().max(180).optional().nullable(),
  required: z.boolean().default(false),
  order: z.number().int().min(0).default(0),
  config: fieldConfigSchema.optional(),
});
export type UpsertFormField = z.infer<typeof upsertFormFieldSchema>;

export const createFormInputSchema = z.object({
  title: z.string().min(1).max(140),
  description: z.string().max(5000).optional().nullable(),
  slug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be kebab-case")
    .optional(),
  visibility: formVisibilitySchema.default("UNLISTED"),
  themeId: z.string().uuid().optional().nullable(),
  settings: z.record(z.string(), z.any()).optional(),
});
export type CreateFormInput = z.infer<typeof createFormInputSchema>;

export const updateFormInputSchema = z.object({
  formId: z.string().uuid(),
  title: z.string().min(1).max(140).optional(),
  description: z.string().max(5000).optional().nullable(),
  slug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be kebab-case")
    .optional(),
  visibility: formVisibilitySchema.optional(),
  themeId: z.string().uuid().optional().nullable(),
  settings: z.record(z.string(), z.any()).optional(),
});
export type UpdateFormInput = z.infer<typeof updateFormInputSchema>;

export const publishFormInputSchema = z.object({
  formId: z.string().uuid(),
  publish: z.boolean(),
});

export const upsertFieldsInputSchema = z.object({
  formId: z.string().uuid(),
  fields: z.array(upsertFormFieldSchema).min(0).max(200),
});

export const publicFormSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  visibility: formVisibilitySchema,
  status: formStatusSchema,
  themeId: z.string().uuid().nullable().optional(),
  settings: z.record(z.string(), z.any()),
  fields: z.array(
    upsertFormFieldSchema.pick({
      key: true,
      type: true,
      label: true,
      helpText: true,
      placeholder: true,
      required: true,
      order: true,
      config: true,
    }),
  ),
});

