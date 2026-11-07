import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production", "prod"]).default("development"),
  BASE_URL: z.string().default("http://localhost:8000"),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  AUTHORIZED_PARTIES: z
    .string()
    .default("http://localhost:3001,http://127.0.0.1:3001")
    .transform((value) => value.split(",").map((entry) => z.url().parse(entry.trim()))),
});

function createEnv(env: NodeJS.ProcessEnv) {
  const safeParseResult = envSchema.safeParse(env);
  if (!safeParseResult.success) throw new Error(safeParseResult.error.message);
  return safeParseResult.data;
}

export const env = createEnv(process.env);
