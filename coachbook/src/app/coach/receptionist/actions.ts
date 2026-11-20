"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMyCoach } from "@/lib/auth";
import { liveMessage, receptionistStatus } from "@/lib/receptionist/activation";
import { isReceptionistConfigured } from "@/lib/receptionist/run";
import { receptionistSettingsSchema } from "@/lib/receptionist/settings";
import type { ActionState } from "@/lib/types";
import { firstError } from "@/lib/validation";

export async function saveReceptionistSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { coach, supabase } = await getMyCoach();
  if (!coach) redirect("/coach/profile");

  let faqs: unknown = [];
  try {
    faqs = JSON.parse(String(formData.get("faqs") ?? "[]"));
  } catch {
    return { error: "Couldn't read your questions. Please try again." };
  }
  const before = await receptionistStatus(supabase, coach.id);
  const paused = formData.get("paused") === "on";
  const parsed = receptionistSettingsSchema.safeParse({
    paused,
    saved_at: before.settings.saved_at ?? new Date().toISOString(),
    tone: formData.get("tone"),
    greeting: formData.get("greeting") ?? "",
    // Questions left without an answer (e.g. the suggested ones) are simply not added.
    faqs: Array.isArray(faqs) ? faqs.filter((f) => f && String(f.a ?? "").trim()) : [],
    cancellation_notice_hours: formData.get("cancellation_notice_hours") ?? 24,
    extra_instructions: formData.get("extra_instructions") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };

  // On once the essentials are in place (sessions + hours; these settings are being saved now), unless paused.
  const stillMissing = before.missing.filter((m) => m.href !== "/coach/receptionist");
  const enabled = !paused && stillMissing.length === 0 && isReceptionistConfigured();
  const { error } = await supabase.from("coaches").update({ receptionist_settings: { ...parsed.data, enabled } }).eq("id", coach.id);
  if (error) return { error: "Couldn't save. Please try again." };
  revalidatePath("/coach", "layout");
  revalidatePath(`/${coach.slug}`);

  if (paused) return { success: "Saved – your receptionist is paused. It won't appear on your page until you switch it back on." };
  if (!isReceptionistConfigured()) return { success: "Saved. The AI service isn't connected yet, so your receptionist can't go live." };
  if (!enabled) return { success: `Saved. Your receptionist will switch on automatically once you've added ${stillMissing.map((m) => m.label).join(" and ")}.` };
  if (before.state !== "live") return { highlight: liveMessage(before.published) };
  return { success: "Saved – your receptionist is live with these settings." };
}
