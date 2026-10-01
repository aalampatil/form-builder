import { z } from "zod";

export const submitResponseInputSchema = z.object({
  slug: z.string().min(3).max(120),
  answers: z.record(z.string(), z.any()),
  respondentEmail: z.string().email().optional().nullable(),
  receiveEmailCopy: z.boolean().optional().default(false),
  formPassword: z.string().optional().nullable(),
  honeypot: z.string().optional().nullable(),
});

export const submitResponseOutputSchema = z.object({
  responseId: z.string().uuid(),
  submittedAt: z.coerce.date(),
});

export const listResponsesInputSchema = z.object({
  formId: z.string().uuid(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export const getResponseInputSchema = z.object({
  formId: z.string().uuid(),
  responseId: z.string().uuid(),
});

export const analyticsInputSchema = z.object({
  formId: z.string().uuid(),
});

