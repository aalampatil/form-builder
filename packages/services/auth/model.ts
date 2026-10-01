import { z } from "zod";

export const signUpInputSchema = z.object({
  fullName: z.string().min(2).max(80),
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
});
export type SignUpInput = z.infer<typeof signUpInputSchema>;

export const signInInputSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
});
export type SignInInput = z.infer<typeof signInInputSchema>;

export const userPublicSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  email: z.string().email(),
  role: z.enum(["CREATOR", "ADMIN"]),
  profileImageUrl: z.string().nullable().optional(),
});
export type UserPublic = z.infer<typeof userPublicSchema>;

