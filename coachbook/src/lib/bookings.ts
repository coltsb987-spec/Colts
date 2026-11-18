import "server-only";
import { createAdminClient, getUserEmail } from "@/lib/supabase/admin";
import { emailLayout, sendEmail } from "@/lib/email";
import { formatPrice } from "@/lib/format";
import { siteUrl } from "@/lib/site";
import { computeSlots, formatSlotDate, formatSlotTime, londonDate, type DaySlots, type ExistingBooking } from "@/lib/slots";
import { BOOKABLE_SUBSCRIPTION_STATUSES, stripe } from "@/lib/stripe";
import type { AvailabilityException, AvailabilityRule, Service } from "@/lib/types";

export const HOLD_MINUTES = 35; // Stripe Checkout links expire after 30 minutes
export const BOOKING_DAYS_AHEAD = 28;

export type BookingCoach = {
  id: string;
  profile_id: string;
  business_name: string;
  slug: string;
  published: boolean;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  subscription_status: string;
  booking_notice_hours: number;
};

const COACH_COLS = "id, profile_id, business_name, slug, published, stripe_account_id, stripe_charges_enabled, subscription_status, booking_notice_hours";

export async function loadCoach(coachId: string): Promise<BookingCoach | null> {
  const { data } = await createAdminClient().from("coaches").select(COACH_COLS).eq("id", coachId).maybeSingle<BookingCoach>();
  return data;
}

export async function loadCoachBySlug(slug: string): Promise<BookingCoach | null> {
  const { data } = await createAdminClient().from("coaches").select(COACH_COLS).eq("slug", slug).maybeSingle<BookingCoach>();
  return data;
}

/** Whether parents can book this service online right now, and if not, why. */
export function bookability(coach: BookingCoach, service: Pick<Service, "price_pence" | "active">): { ok: true } | { ok: false; reason: string } {
  if (!coach.published || !service.active) return { ok: false, reason: "This session isn't available to book." };
  if (!BOOKABLE_SUBSCRIPTION_STATUSES.includes(coach.subscription_status))
    return { ok: false, reason: "This coach isn't taking online bookings at the moment." };
  if (service.price_pence > 0 && !(coach.stripe_account_id && coach.stripe_charges_enabled))
    return { ok: false, reason: "This coach hasn't set up online payments yet." };
  return { ok: true };
}

export async function getSlots(service: Service, coach: BookingCoach, opts: { excludeBookingId?: string; now?: Date } = {}): Promise<DaySlots[]> {
  const admin = createAdminClient();
  const now = opts.now ?? new Date();
  const [{ data: rules }, { data: exceptions }, { data: bookings }] = await Promise.all([
    admin.from("availability_rules").select("*").eq("coach_id", coach.id),
    admin.from("availability_exceptions").select("*").eq("coach_id", coach.id).gte("date", londonDate(now)),
    admin
      .from("bookings")
      .select("id, start_at, end_at, slot_key, status, hold_expires_at")
      .eq("coach_id", coach.id)
      .in("status", ["pending", "confirmed"])
      .gte("end_at", now.toISOString()),
  ]);
  return computeSlots({
    service,
    rules: (rules ?? []) as AvailabilityRule[],
    exceptions: (exceptions ?? []) as AvailabilityException[],
    bookings: (bookings ?? []) as ExistingBooking[],
    now,
    days: BOOKING_DAYS_AHEAD,
    noticeHours: coach.booking_notice_hours,
    excludeBookingId: opts.excludeBookingId,
  });
}

// ---------------------------------------------------------------------------
// Booking details + emails
// ---------------------------------------------------------------------------
export type BookingDetails = {
  id: string;
  coach_id: string;
  start_at: string;
  end_at: string;
  status: string;
  payment_status: string;
  price_pence: number;
  platform_fee_pence: number;
  booked_by_profile_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  services: { name: string; type: string; location: string | null } | null;
  coaches: { business_name: string; slug: string; profile_id: string; stripe_account_id: string | null } | null;
  players: { first_name: string; age_group: string } | null;
};

export async function getBookingDetails(id: string): Promise<BookingDetails | null> {
  const { data } = await createAdminClient()
    .from("bookings")
    .select(
      "id, coach_id, start_at, end_at, status, payment_status, price_pence, platform_fee_pence, booked_by_profile_id, stripe_payment_intent_id, stripe_checkout_session_id, services(name, type, location), coaches(business_name, slug, profile_id, stripe_account_id), players(first_name, age_group)",
    )
    .eq("id", id)
    .maybeSingle<BookingDetails>();
  return data;
}

function when(b: { start_at: string; end_at: string }) {
  return `${formatSlotDate(b.start_at, { long: true })}, ${formatSlotTime(b.start_at)}–${formatSlotTime(b.end_at)}`;
}

async function emailBooking(b: BookingDetails, kind: "confirmed" | "cancelled" | "rescheduled" | "reminder", extra?: string) {
  const parentEmail = await getUserEmail(b.booked_by_profile_id);
  const coachEmail = await getUserEmail(b.coaches?.profile_id);
  const service = b.services?.name ?? "Session";
  const coach = b.coaches?.business_name ?? "your coach";
  const player = b.players?.first_name ?? "your player";
  const where = b.services?.location ? `Where: ${b.services.location}` : "Your coach will confirm the location.";
  const parentLink = { label: "View booking", url: `${siteUrl()}/parent/bookings/${b.id}` };
  const coachLink = { label: "Open your bookings", url: `${siteUrl()}/coach/bookings` };

  const parent = {
    confirmed: { s: `Booked: ${service} with ${coach}`, h: "You're booked in", l: [`${service} with ${coach} for ${player}.`, `When: ${when(b)} (UK time)`, where, b.price_pence ? `Paid: ${formatPrice(b.price_pence)}` : "Price: Free"] },
    cancelled: { s: `Cancelled: ${service} with ${coach}`, h: "Your session was cancelled", l: [`${service} with ${coach} on ${when(b)} has been cancelled.`, extra ?? ""] },
    rescheduled: { s: `New time: ${service} with ${coach}`, h: "Your session has moved", l: [`${service} with ${coach} for ${player} is now on:`, `${when(b)} (UK time)`, where] },
    reminder: { s: `Tomorrow: ${service} with ${coach}`, h: "See you tomorrow", l: [`Reminder: ${service} with ${coach} for ${player}.`, `When: ${when(b)} (UK time)`, where, "Bring water, boots and shin pads."] },
  }[kind];
  await sendEmail({ to: parentEmail, subject: parent.s, ...emailLayout({ heading: parent.h, lines: parent.l.filter(Boolean), cta: parentLink }) });

  if (kind === "reminder") return;
  const coachMsg = {
    confirmed: { s: `New booking: ${service}, ${when(b)}`, l: [`${player} (${b.players?.age_group ?? ""}) booked ${service}.`, `When: ${when(b)}`, b.price_pence ? `Paid: ${formatPrice(b.price_pence)}` : "Free session"] },
    cancelled: { s: `Cancelled: ${service}, ${when(b)}`, l: [`The booking for ${player} on ${when(b)} is cancelled.`, extra ?? ""] },
    rescheduled: { s: `Moved: ${service} for ${player}`, l: [`Now on ${when(b)}.`] },
  }[kind];
  await sendEmail({ to: coachEmail, subject: coachMsg.s, ...emailLayout({ heading: coachMsg.s, lines: coachMsg.l.filter(Boolean), cta: coachLink }) });
}

// ---------------------------------------------------------------------------
// State changes (server only)
// ---------------------------------------------------------------------------

/** Marks a booking as confirmed + paid. Safe to call more than once (webhook + return page). */
export async function confirmBooking(bookingId: string, paymentIntentId: string | null, paid: boolean) {
  const admin = createAdminClient();
  const { data: updated } = await admin
    .from("bookings")
    .update({
      status: "confirmed",
      payment_status: paid ? "paid" : "unpaid",
      stripe_payment_intent_id: paymentIntentId,
      hold_expires_at: null,
    })
    .eq("id", bookingId)
    .eq("status", "pending")
    .select("id");

  if (updated?.length) {
    const b = await getBookingDetails(bookingId);
    if (b) await emailBooking(b, "confirmed");
    return "confirmed" as const;
  }

  const b = await getBookingDetails(bookingId);
  if (b?.status === "cancelled" && paid && paymentIntentId && b.coaches?.stripe_account_id) {
    // Paid after the hold ran out and the slot was released: give the money back.
    await stripe().refunds.create(
      { payment_intent: paymentIntentId, ...(b.platform_fee_pence ? { refund_application_fee: true } : {}) },
      { stripeAccount: b.coaches.stripe_account_id },
    );
    await admin.from("bookings").update({ payment_status: "refunded", stripe_payment_intent_id: paymentIntentId }).eq("id", bookingId);
    await emailBooking(b, "cancelled", "The payment arrived after your slot was released, so we've refunded you in full. Please book again.");
    return "refunded_late" as const;
  }
  return "unchanged" as const;
}

/** Cancels a booking. Refunds in full if it was paid. */
export async function cancelBooking(bookingId: string, by: "coach" | "parent" | "system") {
  const admin = createAdminClient();
  const b = await getBookingDetails(bookingId);
  if (!b || !["pending", "confirmed"].includes(b.status)) return { ok: false as const, error: "This booking can't be cancelled." };
  const account = b.coaches?.stripe_account_id ?? undefined;

  let refunded = false;
  if (b.payment_status === "paid" && b.stripe_payment_intent_id) {
    await stripe().refunds.create(
      { payment_intent: b.stripe_payment_intent_id, ...(b.platform_fee_pence ? { refund_application_fee: true } : {}) },
      { stripeAccount: account },
    );
    refunded = true;
  } else if (b.status === "pending" && b.stripe_checkout_session_id && account) {
    // Close the unpaid payment page so it can't be paid later.
    await stripe().checkout.sessions.expire(b.stripe_checkout_session_id, {}, { stripeAccount: account }).catch(() => undefined);
  }

  await admin
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: by,
      hold_expires_at: null,
      ...(refunded ? { payment_status: "refunded" } : {}),
    })
    .eq("id", bookingId);

  if (b.status === "confirmed") {
    await emailBooking(b, "cancelled", refunded ? `A full refund of ${formatPrice(b.price_pence)} is on its way (usually 5–10 working days).` : undefined);
  }
  return { ok: true as const, refunded };
}

export async function rescheduleBooking(bookingId: string, newStartIso: string) {
  const { error } = await createAdminClient().rpc("reschedule_booking", { p_booking_id: bookingId, p_new_start: newStartIso });
  if (error) return { ok: false as const, error: bookingErrorMessage(error) };
  const b = await getBookingDetails(bookingId);
  if (b?.status === "confirmed") await emailBooking(b, "rescheduled");
  return { ok: true as const };
}

export async function sendReminder(b: BookingDetails) {
  await emailBooking(b, "reminder");
}

export function bookingErrorMessage(error: { code?: string; message?: string }): string {
  if (error.code === "23P01") return "Sorry – that time has just been taken. Please pick another.";
  if (error.message?.includes("slot_full")) return "Sorry – that session has just filled up. Please pick another.";
  if (error.message?.includes("service_unavailable")) return "This session is no longer available.";
  if (error.message?.includes("booking_not_active")) return "This booking can't be changed.";
  console.error("booking error", error);
  return "Something went wrong. Please try again.";
}
