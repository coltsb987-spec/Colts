import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isReceptionistConfigured } from "./run";
import { readSettings, type ReceptionistSettings } from "./settings";

// The receptionist switches itself on once a coach has the essentials:
// a profile, at least one active session, weekly hours, and saved receptionist settings.

export type ReceptionistStatus = {
  state: "live" | "paused" | "waiting";
  missing: { label: string; href: string }[];
  published: boolean;
  settings: ReceptionistSettings;
};

export async function receptionistStatus(supabase: SupabaseClient, coachId: string): Promise<ReceptionistStatus> {
  const [{ data: coach }, { count: sessions }, { count: hours }] = await Promise.all([
    supabase.from("coaches").select("published, receptionist_settings").eq("id", coachId).single(),
    supabase.from("services").select("id", { count: "exact", head: true }).eq("coach_id", coachId).eq("active", true),
    supabase.from("availability_rules").select("id", { count: "exact", head: true }).eq("coach_id", coachId),
  ]);
  const settings = readSettings(coach?.receptionist_settings);
  const missing = [
    ...(sessions ? [] : [{ label: "at least one session", href: "/coach/services" }]),
    ...(hours ? [] : [{ label: "your weekly hours", href: "/coach/availability" }]),
    ...(settings.saved_at ? [] : [{ label: "your receptionist settings (press Save)", href: "/coach/receptionist" }]),
  ];
  const state = settings.paused ? "paused" : settings.enabled ? "live" : "waiting";
  return { state, missing, published: Boolean(coach?.published), settings };
}

export function liveMessage(published: boolean) {
  return published
    ? "Your receptionist is now live – parents can chat with it on your booking page."
    : "Your receptionist is now live – it will appear on your booking page as soon as you publish it.";
}

/**
 * Called after a coach saves something. If everything is now in place (and they haven't
 * paused it), switch the receptionist on and return the message to show.
 */
export async function autoActivateReceptionist(supabase: SupabaseClient, coachId: string): Promise<string | undefined> {
  if (!isReceptionistConfigured()) return undefined;
  const status = await receptionistStatus(supabase, coachId);
  if (status.state !== "waiting" || status.missing.length > 0) return undefined;
  const { error } = await supabase
    .from("coaches")
    .update({ receptionist_settings: { ...status.settings, enabled: true } })
    .eq("id", coachId);
  if (error) {
    console.error("auto-activate receptionist failed", error.message);
    return undefined;
  }
  return liveMessage(status.published);
}
