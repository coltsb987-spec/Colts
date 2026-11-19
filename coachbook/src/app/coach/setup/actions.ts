"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getMyCoach } from "@/lib/auth";
import { readSettings } from "@/lib/receptionist/settings";
import { draftProfile, isSetupAssistantConfigured, readLinks } from "@/lib/setup-assistant/draft";
import { MAX_LINKS, MAX_SOURCE_CHARS, profileDraftSchema, type ProfileDraft } from "@/lib/setup-assistant/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { availabilityRuleSchema, coachProfileSchema, RESERVED_SLUGS, serviceSchema, slugify } from "@/lib/validation";

const DRAFTS_PER_DAY = Number(process.env.SETUP_ASSISTANT_DRAFTS_PER_DAY ?? 10);

export type DraftState =
  | { ok: true; draft: ProfileDraft; linkNotes: string; pastedText: string; round: number }
  | { ok: false; error: string };

const draftRequest = z.object({
  pastedText: z.string().trim().max(MAX_SOURCE_CHARS, `Please keep it under ${MAX_SOURCE_CHARS} characters`),
  links: z.array(z.url({ protocol: /^https?$/, error: "Links must start with http:// or https://" })).max(MAX_LINKS),
  linkNotes: z.string().max(15000).default(""),
  answers: z.array(z.object({ question: z.string().max(300), answer: z.string().trim().max(1000) })).max(5).default([]),
  previous: profileDraftSchema.nullable().default(null),
  round: z.number().int().min(0).max(5).default(0),
});

/** Uses the coach's daily allowance (stored server-side in their auth record). */
async function takeDraftAllowance(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(userId);
  const today = new Date().toISOString().slice(0, 10);
  const used = (data.user?.app_metadata?.setup_drafts as { day?: string; count?: number } | undefined) ?? {};
  const count = used.day === today ? used.count ?? 0 : 0;
  if (count >= DRAFTS_PER_DAY) return false;
  await admin.auth.admin.updateUserById(userId, { app_metadata: { ...data.user?.app_metadata, setup_drafts: { day: today, count: count + 1 } } });
  return true;
}

export async function requestDraft(payload: unknown): Promise<DraftState> {
  const { user } = await getMyCoach();
  if (!isSetupAssistantConfigured()) return { ok: false, error: "The assistant isn't available right now." };
  const parsed = draftRequest.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check what you entered." };
  const req = parsed.data;
  if (!req.pastedText && req.links.length === 0 && !req.previous) return { ok: false, error: "Tell us a bit about your coaching, or add a link." };
  if (!(await takeDraftAllowance(user.id))) return { ok: false, error: "You've used today's drafts. Please try again tomorrow, or fill in your profile by hand." };

  try {
    // Links are read once; later rounds reuse the notes.
    const linkNotes = req.linkNotes || (await readLinks(req.links));
    const draft = await draftProfile({ pastedText: req.pastedText, linkNotes, answers: req.answers.filter((a) => a.answer), previous: req.previous });
    return { ok: true, draft, linkNotes, pastedText: req.pastedText, round: req.round + 1 };
  } catch (e) {
    console.error("setup assistant failed", e);
    return { ok: false, error: "The assistant couldn't finish. Please try again in a minute." };
  }
}

// ---------------------------------------------------------------------------
// Saving the parts the coach approved
// ---------------------------------------------------------------------------
const applySchema = z.object({
  profile: z.object({
    business_name: z.string().optional(),
    bio: z.string().optional(),
    qualifications: z.string().optional(),
    postcode: z.string().optional(),
  }),
  services: z.array(z.object({
    name: z.string(), type: z.enum(["one_to_one", "group", "camp"]), duration_minutes: z.number(), price: z.string(),
    max_participants: z.number().nullable(), location: z.string().nullable(), description: z.string().nullable(),
  })).max(20),
  weekly_hours: z.array(z.object({ weekday: z.number(), start: z.string(), end: z.string(), location: z.string().nullable() })).max(30),
  faqs: z.array(z.object({ q: z.string(), a: z.string() })).max(30),
});

export type ApplyState = { ok: true; saved: string[]; skipped: string[] } | { ok: false; error: string };

async function uniqueSlug(base: string): Promise<string> {
  let root = slugify(base);
  if (root.length < 3 || RESERVED_SLUGS.has(root)) root = `${root || "coach"}-coaching`.replace(/^-/, "");
  const admin = createAdminClient();
  const { data } = await admin.from("coaches").select("slug").like("slug", `${root}%`);
  const taken = new Set((data ?? []).map((r) => r.slug));
  if (!taken.has(root)) return root;
  for (let i = 2; i < 100; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
  return `${root}-${Date.now().toString(36)}`;
}

export async function applyDraft(payload: unknown): Promise<ApplyState> {
  const { supabase, user, coach: existing } = await getMyCoach();
  const parsed = applySchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "Something didn't look right. Please try again." };
  const { profile, services, weekly_hours, faqs } = parsed.data;
  const saved: string[] = [];
  const skipped: string[] = [];

  // 1. Profile (create the coach row if this is a new coach).
  let coach = existing;
  if (!coach && !profile.business_name?.trim()) return { ok: false, error: "Please keep a business name so we can create your page." };
  const merged = {
    business_name: profile.business_name ?? coach?.business_name ?? "",
    slug: coach?.slug ?? (await uniqueSlug(profile.business_name!)),
    bio: profile.bio ?? coach?.bio ?? "",
    postcode: profile.postcode ?? coach?.postcode ?? "",
    qualifications: profile.qualifications ?? coach?.qualifications ?? "",
    dbs_checked: coach?.dbs_checked ?? false,
    dbs_date: coach?.dbs_date ?? "",
    booking_notice_hours: coach?.booking_notice_hours ?? 12,
  };
  const p = coachProfileSchema.safeParse(merged);
  if (!p.success) return { ok: false, error: `Profile: ${p.error.issues[0]?.message}` };
  const values = { ...p.data, postcode: p.data.postcode?.toUpperCase() ?? null };
  if (coach) {
    if (Object.values(profile).some((v) => v !== undefined)) {
      const { error } = await supabase.from("coaches").update(values).eq("id", coach.id);
      if (error) return { ok: false, error: "Couldn't save your profile." };
      saved.push("profile");
    }
  } else {
    const { error } = await supabase.from("coaches").insert({ ...values, profile_id: user.id });
    if (error) return { ok: false, error: error.code === "23505" ? "That business name's link is taken – edit the name slightly." : "Couldn't create your profile." };
    saved.push(`profile (your link: /${values.slug})`);
    coach = (await getMyCoach()).coach;
  }
  if (!coach) return { ok: false, error: "Couldn't create your profile." };

  // 2. Sessions
  for (const s of services) {
    const sp = serviceSchema.safeParse({ ...s, max_participants: s.max_participants ?? 1, location: s.location ?? "", description: s.description ?? "" });
    if (!sp.success) {
      skipped.push(`“${s.name}”: ${sp.error.issues[0]?.message}`);
      continue;
    }
    const { price, ...rest } = sp.data;
    const { error } = await supabase.from("services").insert({ ...rest, price_pence: price, coach_id: coach.id });
    if (error) skipped.push(`“${s.name}”: couldn't save`);
    else saved.push(`session “${s.name}”`);
  }

  // 3. Weekly hours (skipping any that overlap hours already saved)
  const { data: existingRules } = await supabase.from("availability_rules").select("weekday, start_time, end_time").eq("coach_id", coach.id);
  const rules = (existingRules ?? []).map((r) => ({ weekday: r.weekday, start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5) }));
  for (const h of weekly_hours) {
    const hp = availabilityRuleSchema.safeParse({ weekday: h.weekday, start_time: h.start, end_time: h.end, location: h.location ?? "" });
    if (!hp.success) {
      skipped.push(`hours ${h.start}–${h.end}: ${hp.error.issues[0]?.message}`);
      continue;
    }
    if (rules.some((r) => r.weekday === hp.data.weekday && hp.data.start_time < r.end && hp.data.end_time > r.start)) {
      skipped.push(`hours ${h.start}–${h.end}: overlap hours you already have`);
      continue;
    }
    const { error } = await supabase.from("availability_rules").insert({ ...hp.data, coach_id: coach.id });
    if (error) skipped.push(`hours ${h.start}–${h.end}: couldn't save`);
    else {
      rules.push({ weekday: hp.data.weekday, start: hp.data.start_time, end: hp.data.end_time });
      saved.push("weekly hours");
    }
  }

  // 4. FAQs -> receptionist settings (added to any already there)
  const goodFaqs = faqs.map((f) => ({ q: f.q.trim().slice(0, 200), a: f.a.trim().slice(0, 1000) })).filter((f) => f.q.length >= 3 && f.a);
  if (goodFaqs.length) {
    const { data } = await supabase.from("coaches").select("receptionist_settings").eq("id", coach.id).single();
    const settings = readSettings(data?.receptionist_settings);
    const known = new Set(settings.faqs.map((f) => f.q.toLowerCase()));
    const merged = [...settings.faqs, ...goodFaqs.filter((f) => !known.has(f.q.toLowerCase()))].slice(0, 30);
    const { error } = await supabase.from("coaches").update({ receptionist_settings: { ...settings, faqs: merged } }).eq("id", coach.id);
    if (error) skipped.push("FAQs: couldn't save");
    else saved.push(`${merged.length - settings.faqs.length} FAQ answers for your receptionist`);
  }

  revalidatePath("/coach", "layout");
  revalidatePath(`/${coach.slug}`);
  const summary = [...new Set(saved.filter((s) => s !== "weekly hours")), ...(saved.includes("weekly hours") ? [`${saved.filter((s) => s === "weekly hours").length} sets of weekly hours`] : [])];
  return { ok: true, saved: summary, skipped };
}
