import { z } from "zod";
import type { UpsertFormField } from "./model";

function optionalize<T extends z.ZodTypeAny>(schema: T, required: boolean) {
  return required ? schema : schema.optional();
}

export function buildResponseZodSchema(fields: ReadonlyArray<UpsertFormField>) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    let s: z.ZodTypeAny;
    const cfg = field.config ?? {};

    switch (field.type) {
      case "SHORT_TEXT":
      case "LONG_TEXT": {
        let str = z.string();
        if (typeof cfg.minLength === "number") str = str.min(cfg.minLength);
        if (typeof cfg.maxLength === "number") str = str.max(cfg.maxLength);
        if (cfg.regex) {
          try {
            str = str.regex(new RegExp(cfg.regex));
          } catch {
            // ignore invalid regex at runtime; creators should be validated elsewhere
          }
        }
        s = str;
        break;
      }
      case "EMAIL": {
        s = z.string().email();
        break;
      }
      case "NUMBER": {
        let num = z.number();
        if (typeof cfg.min === "number") num = num.min(cfg.min);
        if (typeof cfg.max === "number") num = num.max(cfg.max);
        s = num;
        break;
      }
      case "SINGLE_SELECT":
      case "DROPDOWN": {
        const options = (cfg.options ?? []).filter(Boolean);
        s = options.length ? z.enum(options as [string, ...string[]]) : z.string();
        break;
      }
      case "MULTI_SELECT": {
        const options = (cfg.options ?? []).filter(Boolean);
        const item = options.length ? z.enum(options as [string, ...string[]]) : z.string();
        let arr = z.array(item);
        if (typeof cfg.minItems === "number") arr = arr.min(cfg.minItems);
        if (typeof cfg.maxItems === "number") arr = arr.max(cfg.maxItems);
        s = arr;
        break;
      }
      case "CHECKBOX": {
        s = z.boolean();
        break;
      }
      case "RATING": {
        let rating = z.number().int();
        if (typeof cfg.min === "number") rating = rating.min(cfg.min);
        if (typeof cfg.max === "number") rating = rating.max(cfg.max);
        s = rating;
        break;
      }
      case "DATE": {
        s = z.string().datetime({ offset: true }).or(z.string().date());
        break;
      }
      default: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _exhaustive: any = field.type;
        s = z.any();
      }
    }

    shape[field.key] = optionalize(s, field.required);
  }

  return z.object(shape).strict();
}
