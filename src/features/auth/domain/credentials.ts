import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_]+$/);

export const passwordSchema = z.string().min(12).max(128);

export const registrationSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const loginSchema = registrationSchema;

export const normalizeUsername = (value: string) => value.toLowerCase();
