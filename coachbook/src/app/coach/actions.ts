"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMyCoach } from "@/lib/auth";
import { autoActivateReceptionist } from "@/lib/receptionist/activation";
import { WEEKDAYS } from "@/lib/format";
import type { ActionState } from "@/lib/types";
import {
  availabilityExceptionSchema,
  availabilityRuleSchema,
  coachProfileSchema,
  firstError,
  serviceSchema,
} from "@/lib/validation";

const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

async function needCoach() {
  const ctx = await getMyCoach();
  if (!ctx.coach) redirect("/coach/profile");
  return { ...ctx, coach: ctx.coach };
}

function refresh(slug?: string) {
  revalidatePath("/coach", "layout");
  if (slug) revalidatePath(`/${slug}`);
}

// ---------- Profile ----------
export async function saveProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user, coach } = await getMyCoach();
  const parsed = coachProfileSchema.safeParse({
    business_name: formData.get("business_name") ?? "",
    slug: formData.get("slug") ?? "",
    bio: formData.get("bio") ?? "",
    postcode: formData.get("postcode") ?? "",
    qualifications: formData.get("qualifications") ?? "",
    dbs_checked: formData.get("dbs_checked") === "on",
    dbs_date: formData.get("dbs_date") ?? "",
    booking_notice_hours: formData.get("booking_notice_hours") ?? 12,
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const values: Record<string, unknown> = { ...parsed.data, postcode: parsed.data.postcode?.toUpperCase() ?? null };

  const photo = formData.get("photo");
  if (photo instanceof File && photo.size > 0) {
    const ext = PHOTO_TYPES[photo.type];
    if (!ext) return { error: "Photo must be a JPG, PNG or WebP image" };
    if (photo.size > MAX_PHOTO_BYTES) return { error: "Photo must be smaller than 5 MB" };
    const path = `${user.id}/photo-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("coach-photos").upload(path, photo, { contentType: photo.type });
    if (upErr) {
      console.error("photo upload failed", upErr.message);
      return { error: "Couldn't upload the photo. Please try again." };
    }
    values.photo_url = supabase.storage.from("coach-photos").getPublicUrl(path).data.publicUrl;
  }

  const { error } = coach
    ? await supabase.from("coaches").update(values).eq("id", coach.id)
    : await supabase.from("coaches").insert({ ...values, profile_id: user.id });

  if (error) {
    if (error.code === "23505") return { error: "That booking link is already taken – try another." };
    console.error("save profile failed", error.message);
    return { error: "Couldn't save your profile. Please try again." };
  }

  const fullName = String(formData.get("full_name") ?? "").trim().slice(0, 120);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 30);
  await supabase.from("profiles").update({ full_name: fullName || null, phone: phone || null }).eq("id", user.id);

  refresh(coach?.slug);
  refresh(parsed.data.slug);
  if (!coach) redirect("/coach/services?welcome=1");
  const live = await autoActivateReceptionist(supabase, coach.id);
  return { success: "Profile saved.", highlight: live };
}

export async function setPublished(publish: boolean, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const { supabase, coach } = await needCoach();
  if (publish) {
    const [{ count: services }, { count: rules }] = await Promise.all([
      supabase.from("services").select("id", { count: "exact", head: true }).eq("coach_id", coach.id).eq("active", true),
      supabase.from("availability_rules").select("id", { count: "exact", head: true }).eq("coach_id", coach.id),
    ]);
    if (!services) return { error: "Add at least one active session type first." };
    if (!rules) return { error: "Add your weekly availability first." };
  }
  const { error } = await supabase.from("coaches").update({ published: publish }).eq("id", coach.id);
  if (error) return { error: "Couldn't update. Please try again." };
  refresh(coach.slug);
  return { success: publish ? "Your booking page is live." : "Your booking page is hidden." };
}

// ---------- Services ----------
function readService(formData: FormData) {
  return serviceSchema.safeParse({
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    type: formData.get("type"),
    duration_minutes: formData.get("duration_minutes"),
    price: formData.get("price") ?? "",
    max_participants: formData.get("max_participants") || 1,
    location: formData.get("location") ?? "",
  });
}

export async function addService(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, coach } = await needCoach();
  const parsed = readService(formData);
  if (!parsed.success) return { error: firstError(parsed.error) };
  const { price, ...rest } = parsed.data;
  const { error } = await supabase.from("services").insert({ ...rest, price_pence: price, coach_id: coach.id });
  if (error) {
    console.error("add service failed", error.message);
    return { error: "Couldn't add the session. Please try again." };
  }
  refresh(coach.slug);
  const live = await autoActivateReceptionist(supabase, coach.id);
  return { success: `Added “${parsed.data.name}”.`, highlight: live };
}

export async function updateService(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, coach } = await needCoach();
  const parsed = readService(formData);
  if (!parsed.success) return { error: firstError(parsed.error) };
  const { price, ...rest } = parsed.data;
  const { error } = await supabase.from("services").update({ ...rest, price_pence: price }).eq("id", id).eq("coach_id", coach.id);
  if (error) return { error: "Couldn't save. Please try again." };
  refresh(coach.slug);
  return { success: "Saved." };
}

export async function setServiceActive(id: string, active: boolean, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const { supabase, coach } = await needCoach();
  const { error } = await supabase.from("services").update({ active }).eq("id", id).eq("coach_id", coach.id);
  if (error) return { error: "Couldn't update." };
  if (active) await autoActivateReceptionist(supabase, coach.id);
  refresh(coach.slug);
  return { success: "Updated." };
}

export async function deleteService(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const { supabase, coach } = await needCoach();
  const { error } = await supabase.from("services").delete().eq("id", id).eq("coach_id", coach.id);
  if (error) {
    // Services with bookings can't be deleted (keeps booking history) – hide them instead.
    if (error.code === "23503") return { error: "This has bookings – hide it instead." };
    return { error: "Couldn't delete." };
  }
  refresh(coach.slug);
  return { success: "Deleted." };
}

// ---------- Availability ----------
export async function addAvailabilityRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, coach } = await needCoach();
  const parsed = availabilityRuleSchema.safeParse({
    weekday: formData.get("weekday"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
    location: formData.get("location") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };

  // Don't allow overlapping hours on the same day.
  const { data: sameDay } = await supabase
    .from("availability_rules")
    .select("start_time, end_time")
    .eq("coach_id", coach.id)
    .eq("weekday", parsed.data.weekday);
  const clash = (sameDay ?? []).some((r) => parsed.data.start_time < r.end_time.slice(0, 5) && parsed.data.end_time > r.start_time.slice(0, 5));
  if (clash) return { error: "These hours overlap with times you've already added for that day." };

  const { error } = await supabase.from("availability_rules").insert({ ...parsed.data, coach_id: coach.id });
  if (error) return { error: "Couldn't add those hours. Please try again." };
  refresh(coach.slug);
  const { start_time, end_time, weekday } = parsed.data;
  const live = await autoActivateReceptionist(supabase, coach.id);
  refresh(coach.slug);
  return { success: `Added ${WEEKDAYS[weekday]} ${start_time}–${end_time}.`, highlight: live };
}

export async function deleteAvailabilityRule(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const { supabase, coach } = await needCoach();
  const { error } = await supabase.from("availability_rules").delete().eq("id", id).eq("coach_id", coach.id);
  if (error) return { error: "Couldn't remove." };
  refresh(coach.slug);
  return { success: "Removed." };
}

export async function addAvailabilityException(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, coach } = await needCoach();
  const parsed = availabilityExceptionSchema.safeParse({
    date: formData.get("date"),
    kind: formData.get("kind"),
    start_time: formData.get("start_time") ?? "",
    end_time: formData.get("end_time") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const today = new Date().toISOString().slice(0, 10);
  if (parsed.data.date < today) return { error: "Choose today or a future date." };
  const { error } = await supabase.from("availability_exceptions").insert({ ...parsed.data, coach_id: coach.id });
  if (error) return { error: "Couldn't save. Please try again." };
  refresh(coach.slug);
  return { success: parsed.data.kind === "blocked" ? "Time blocked off." : "Extra hours added." };
}

export async function deleteAvailabilityException(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const { supabase, coach } = await needCoach();
  const { error } = await supabase.from("availability_exceptions").delete().eq("id", id).eq("coach_id", coach.id);
  if (error) return { error: "Couldn't remove." };
  refresh(coach.slug);
  return { success: "Removed." };
}
