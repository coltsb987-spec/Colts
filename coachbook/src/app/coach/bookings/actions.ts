"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMyCoach } from "@/lib/auth";
import { cancelBooking, getSlots, loadCoach, rescheduleBooking } from "@/lib/bookings";
import { createAdminClient } from "@/lib/supabase/admin";
import { findSlot } from "@/lib/slots";
import type { ActionState, Service } from "@/lib/types";

async function ownBooking(bookingId: string) {
  const { coach, supabase } = await getMyCoach();
  if (!coach) redirect("/coach/profile");
  // RLS: the coach can only see their own bookings.
  const { data } = await supabase.from("bookings").select("id, service_id, status").eq("id", bookingId).eq("coach_id", coach.id).maybeSingle();
  return { coach, booking: data };
}

export async function coachCancelBooking(bookingId: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const { booking } = await ownBooking(bookingId);
  if (!booking) return { error: "Booking not found." };
  try {
    const res = await cancelBooking(bookingId, "coach");
    if (!res.ok) return { error: res.error };
  } catch (e) {
    console.error("cancel failed", e);
    return { error: "Couldn't cancel – the refund didn't go through. Please try again." };
  }
  revalidatePath("/coach/bookings");
  return { success: "Cancelled." };
}

export async function coachRescheduleBooking(bookingId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { coach, booking } = await ownBooking(bookingId);
  if (!booking || !["pending", "confirmed"].includes(booking.status)) return { error: "This booking can't be moved." };
  const start = String(formData.get("start") ?? "");
  if (!start) return { error: "Please choose a new time." };

  const { data: service } = await createAdminClient().from("services").select("*").eq("id", booking.service_id).single<Service>();
  const fullCoach = await loadCoach(coach.id);
  // Coaches may move a session inside their hours even at short notice.
  const slot = findSlot(await getSlots(service!, { ...fullCoach!, booking_notice_hours: 0 }, { excludeBookingId: bookingId }), start);
  if (!slot) return { error: "That time isn't free. Please pick another." };

  const res = await rescheduleBooking(bookingId, slot.start);
  if (!res.ok) return { error: res.error };
  revalidatePath("/coach/bookings");
  redirect("/coach/bookings?moved=1");
}
