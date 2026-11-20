"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { passwordProblem } from "@/lib/password";
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

// ---------------------------------------------------------------------------
// Password sign-in, sign-up and reset
// ---------------------------------------------------------------------------

async function siteOrigin() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? (await headers()).get("origin") ?? "http://localhost:3000";
}

const passwordSignIn = z.object({
  email: z.email("Enter a valid email address").trim().toLowerCase(),
  password: z.string().min(1, "Enter your password").max(200),
  as: z.enum(["coach", "parent"]),
  next: z.string().optional(),
});

export async function signInWithPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = passwordSignIn.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    as: formData.get("as"),
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { email, password, next } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") return { error: "Please confirm your email first – use the link we sent you, or choose “Email me a link”." };
    if (error.status === 429) return { error: "Too many attempts – please wait a minute and try again." };
    // Same message whether the email exists or not.
    return { error: "That email and password don't match. Try again, or use “Forgot password?”." };
  }
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).single();
  const home = profile?.role === "coach" ? "/coach" : "/parent";
  let dest = safeNextPath(next, home);
  if ((dest.startsWith("/coach") || dest.startsWith("/parent")) && !dest.startsWith(home)) dest = home;
  redirect(dest);
}

const passwordSignUp = z
  .object({
    email: z.email("Enter a valid email address").trim().toLowerCase(),
    full_name: z.string().trim().min(1, "Enter your name").max(120),
    password: z.string().max(200),
    confirm: z.string(),
    as: z.enum(["coach", "parent"]),
    next: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    const problem = passwordProblem(d.password, d.email);
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["password"] });
    else if (d.password !== d.confirm) ctx.addIssue({ code: "custom", message: "The two passwords don't match.", path: ["confirm"] });
  });

export async function signUpWithPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = passwordSignUp.safeParse({
    email: formData.get("email"),
    full_name: formData.get("full_name"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
    as: formData.get("as"),
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { email, full_name, password, as, next } = parsed.data;

  const confirmUrl = new URL("/auth/confirm", await siteOrigin());
  confirmUrl.searchParams.set("next", safeNextPath(next, as === "coach" ? "/coach" : "/parent"));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: confirmUrl.toString(), data: { role: as, full_name } },
  });
  if (error) {
    if (error.code === "weak_password") return { error: "That password is too weak. Try a longer one, like three random words." };
    if (error.status === 429) return { error: "Too many attempts – please wait a minute and try again." };
    console.error("signUp failed", error.message);
    return { error: "We couldn't create your account. Please try again." };
  }
  // If email confirmation is off (local dev), the account is ready straight away.
  if (data.session) redirect(safeNextPath(next, as === "coach" ? "/coach" : "/parent"));
  // Same message whether or not the email already had an account.
  return { success: `Nearly there – check ${email} and tap the link to confirm your account.` };
}

const resetRequest = z.object({ email: z.email("Enter a valid email address").trim().toLowerCase() });

export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetRequest.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const url = new URL("/auth/confirm", await siteOrigin());
  url.searchParams.set("next", "/reset-password");
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: url.toString() });
  if (error?.status === 429) return { error: "Too many attempts – please wait a minute and try again." };
  if (error) console.error("reset request failed", error.message);
  // Same message whether the account exists or not.
  return { success: `If there's an account for ${parsed.data.email}, we've emailed a link to choose a new password.` };
}

const newPassword = z.object({ password: z.string().max(200), confirm: z.string() });

export async function updatePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = newPassword.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { error: "Please enter your new password twice." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your reset link has expired. Please ask for a new one." };
  const problem = passwordProblem(parsed.data.password, user.email);
  if (problem) return { error: problem };
  if (parsed.data.password !== parsed.data.confirm) return { error: "The two passwords don't match." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return { error: "That's your current password – choose a different one." };
    if (error.code === "weak_password") return { error: "That password is too weak. Try a longer one." };
    console.error("update password failed", error.message);
    return { error: "We couldn't save your new password. Please try again." };
  }
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  redirect(`${profile?.role === "coach" ? "/coach" : "/parent"}?password=updated`);
}
