import { z } from "zod";

export const BUSINESS_TYPES = [
  "Plumbing & heating",
  "Cleaning",
  "Beauty & wellness",
  "Estate agency",
  "Dental practice",
  "Legal services",
  "Other",
] as const;

export const businessSchema = z.object({
  workspaceId: z.uuid({ message: "Workspace is missing. Refresh the page and try again." }),
  name: z
    .string({ message: "Enter a business name." })
    .trim()
    .min(2, "Business name must be at least 2 characters.")
    .max(100, "Business name must be 100 characters or fewer."),
  businessType: z.enum(BUSINESS_TYPES, { message: "Choose a business type from the list." }),
});

export type BusinessInput = z.infer<typeof businessSchema>;

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email({ message: "Enter a valid email address." })),
  password: z.string().min(1, "Enter your password.").max(72, "Password is too long."),
});

export const signUpSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email({ message: "Enter a valid email address." })),
  // 72 is the bcrypt limit Supabase Auth hashes with.
  password: z
    .string()
    .min(10, "Use at least 10 characters for your password.")
    .max(72, "Password must be 72 characters or fewer."),
});

export type FieldErrors = Record<string, string>;

export function firstErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
