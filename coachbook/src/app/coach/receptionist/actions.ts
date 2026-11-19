"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMyCoach } from "@/lib/auth";
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
  const parsed = receptionistSettingsSchema.safeParse({
    enabled: formData.get("enabled") === "on",
    tone: formData.get("tone"),
    greeting: formData.get("greeting") ?? "",
    faqs: Array.isArray(faqs) ? faqs.filter((f) => f && (String(f.q ?? "").trim() || String(f.a ?? "").trim())) : [],
    cancellation_notice_hours: formData.get("cancellation_notice_hours") ?? 24,
    extra_instructions: formData.get("extra_instructions") ?? "",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };

  const { error } = await supabase.from("coaches").update({ receptionist_settings: parsed.data }).eq("id", coach.id);
  if (error) return { error: "Couldn't save. Please try again." };
  revalidatePath("/coach/receptionist");
  revalidatePath(`/${coach.slug}`);
  return { success: parsed.data.enabled ? "Saved – your receptionist is on." : "Saved – your receptionist is off." };
}
