"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { bookability, createParentBooking, loadCoachBySlug } from "@/lib/bookings";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState, Service } from "@/lib/types";
import { firstError, playerSchema } from "@/lib/validation";

export async function createBooking(slug: string, serviceId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireRole("parent", `/${slug}/book/${serviceId}`);
  const admin = createAdminClient();

  const coach = await loadCoachBySlug(slug);
  const { data: service } = await admin.from("services").select("*").eq("id", serviceId).maybeSingle<Service>();
  if (!coach || !service || service.coach_id !== coach.id) return { error: "This session isn't available." };
  const can = bookability(coach, service);
  if (!can.ok) return { error: can.reason };

  // 1. The chosen time (checked again when booking).
  const start = String(formData.get("start") ?? "");
  if (!start || Number.isNaN(Date.parse(start))) return { error: "Please choose a time." };

  // 2. Which player? An existing one, or add a new one (with consent).
  let playerId = String(formData.get("player_id") ?? "");
  let playerName = "";
  if (playerId === "new" || !playerId) {
    const parsed = playerSchema.safeParse({
      first_name: formData.get("first_name") ?? "",
      age_group: formData.get("age_group") ?? "",
      notes: formData.get("notes") ?? "",
      consent: formData.get("consent") === "on",
    });
    if (!parsed.success) return { error: firstError(parsed.error) };
    const { consent: _consent, ...player } = parsed.data;
    const { data, error } = await supabase
      .from("players")
      .insert({ ...player, parent_profile_id: user.id, parental_consent_at: new Date().toISOString() })
      .select("id, first_name")
      .single();
    if (error || !data) return { error: "Couldn't save the player. Please try again." };
    playerId = data.id;
    playerName = data.first_name;
  } else {
    // RLS means this only finds the parent's own players.
    const { data } = await supabase.from("players").select("id, first_name").eq("id", playerId).eq("parent_profile_id", user.id).maybeSingle();
    if (!data) return { error: "Please choose a player." };
    playerName = data.first_name;
  }

  // 3. Hold the slot (the database refuses double-bookings) and, if paid, open Stripe Checkout.
  const result = await createParentBooking({
    coach,
    service,
    start,
    playerId,
    playerName,
    parentId: user.id,
    parentEmail: user.email,
    source: "web",
  });
  if (!result.ok) return { error: result.error };
  redirect(result.checkoutUrl ?? `/parent/bookings/${result.bookingId}?booked=1`);
}
