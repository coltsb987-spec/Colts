import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Coach, Profile, UserRole } from "@/lib/types";

export async function getCurrentProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null };
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, full_name, phone")
    .eq("id", user.id)
    .single<Profile>();
  return { supabase, user, profile };
}

export function homeFor(role: UserRole | undefined | null) {
  return role === "coach" ? "/coach" : "/parent";
}

/** Use at the top of a protected page or action. Sends others to the right place. */
export async function requireRole(role: Exclude<UserRole, "admin">) {
  const ctx = await getCurrentProfile();
  if (!ctx.user || !ctx.profile) redirect(`/login?as=${role}`);
  if (ctx.profile.role !== role && ctx.profile.role !== "admin") redirect(`${homeFor(ctx.profile.role)}?wrong_area=${role}`);
  return { supabase: ctx.supabase, user: ctx.user, profile: ctx.profile };
}

export async function getMyCoach() {
  const ctx = await requireRole("coach");
  const { data: coach } = await ctx.supabase
    .from("coaches")
    .select("id, profile_id, business_name, slug, bio, photo_url, postcode, qualifications, dbs_checked, dbs_date, published, subscription_status")
    .eq("profile_id", ctx.user.id)
    .maybeSingle<Coach>();
  return { ...ctx, coach };
}
