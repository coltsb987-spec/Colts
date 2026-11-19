"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { cancelBooking, getBookingDetails, loadCoach, parentChangeAllowed } from "@/lib/bookings";
import { readSettings } from "@/lib/receptionist/settings";
import type { ActionState } from "@/lib/types";

export async function parentCancelBooking(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const { supabase, user } = await requireRole("parent");
  // RLS: only the parent's own booking is found.
  const { data: mine } = await supabase.from("bookings").select("id").eq("id", id).eq("booked_by_profile_id", user.id).maybeSingle();
  if (!mine) return { error: "Booking not found." };
  const b = await getBookingDetails(id);
  const coach = b ? await loadCoach(b.coach_id) : null;
  if (!b || !coach || b.status !== "confirmed") return { error: "This booking can't be cancelled." };
  const notice = readSettings(coach.receptionist_settings).cancellation_notice_hours;
  if (!parentChangeAllowed(b.start_at, notice)) return { error: `Online cancellation closes ${notice} hours before the session – please contact your coach.` };
  try {
    const res = await cancelBooking(id, "parent");
    if (!res.ok) return { error: res.error };
  } catch (e) {
    console.error("parent cancel failed", e);
    return { error: "Couldn't cancel – the refund didn't go through. Please try again." };
  }
  revalidatePath(`/parent/bookings/${id}`);
  return { success: "Cancelled." };
}
