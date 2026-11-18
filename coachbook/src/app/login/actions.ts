"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/validation";
import type { ActionState } from "@/lib/types";

const schema = z.object({
  email: z.email("Enter a valid email address").trim().toLowerCase(),
  full_name: z.string().trim().max(120).optional(),
  as: z.enum(["coach", "parent"]),
  next: z.string().optional(),
});

export async function sendMagicLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    full_name: formData.get("full_name") || undefined,
    as: formData.get("as"),
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { email, full_name, as, next } = parsed.data;

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (await headers()).get("origin") ?? "http://localhost:3000";
  const redirectTo = new URL("/auth/confirm", origin);
  redirectTo.searchParams.set("next", safeNextPath(next, as === "coach" ? "/coach" : "/parent"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo.toString(),
      // Only used when this email is new: it decides whether they become a coach or a parent.
      data: { role: as, full_name: full_name ?? "" },
    },
  });
  if (error) {
    console.error("signInWithOtp failed", error.message);
    return { error: error.status === 429 ? "Too many attempts – please wait a minute and try again." : "We couldn't send the link. Please try again." };
  }
  return { success: `Check ${email} – we've sent you a sign-in link.` };
}
