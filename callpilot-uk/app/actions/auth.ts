"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/routes";
import { firstErrors, signInSchema, signUpSchema, type FieldErrors } from "@/lib/validation";

export type AuthState = { errors?: FieldErrors; message?: string; email?: string };

function siteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signInSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { errors: firstErrors(parsed.error), email };

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // One generic message so the form doesn't reveal which emails have accounts.
    const message =
      error.code === "email_not_confirmed"
        ? "Please confirm your email address first. Check your inbox for the link."
        : error.status === 429
          ? "Too many attempts. Please wait a few minutes and try again."
          : "Incorrect email or password.";
    return { message, email };
  }
  redirect(safeRedirectPath(formData.get("next")));
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { errors: firstErrors(parsed.error), email };

  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${siteOrigin()}/auth/confirm` },
  });
  if (error) {
    if (error.code === "weak_password") return { errors: { password: error.message }, email };
    if (error.status === 429) return { message: "Too many attempts. Please wait a few minutes and try again.", email };
    return { message: "We couldn't create your account. Please try again.", email };
  }
  // If email confirmation is switched off in Supabase, the user is signed in straight away.
  if (data.session) redirect("/");
  return { message: "Check your email for a link to confirm your account, then sign in.", email };
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
