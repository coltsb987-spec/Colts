"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { bookability, bookingErrorMessage, cancelBooking, confirmBooking, getSlots, HOLD_MINUTES, loadCoachBySlug } from "@/lib/bookings";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site";
import { findSlot, formatSlotDate, formatSlotTime } from "@/lib/slots";
import { platformFeePence, stripe } from "@/lib/stripe";
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

  // 1. The chosen time must still be free.
  const start = String(formData.get("start") ?? "");
  if (!start || Number.isNaN(Date.parse(start))) return { error: "Please choose a time." };
  const slot = findSlot(await getSlots(service, coach), start);
  if (!slot) return { error: "Sorry – that time is no longer available. Please pick another." };

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

  // 3. Hold the slot (the database refuses double-bookings).
  const fee = service.price_pence > 0 ? platformFeePence(service.price_pence) : 0;
  const { data: bookingId, error: bookErr } = await admin.rpc("book_slot", {
    p_service_id: service.id,
    p_start: slot.start,
    p_player_id: playerId,
    p_booked_by: user.id,
    p_source: "web",
    p_status: "pending",
    p_hold_minutes: HOLD_MINUTES,
    p_platform_fee: fee,
  });
  if (bookErr || !bookingId) return { error: bookingErrorMessage(bookErr ?? {}) };

  // 4a. Free session: confirm straight away.
  if (service.price_pence === 0) {
    await confirmBooking(bookingId, null, false);
    redirect(`/parent/bookings/${bookingId}?booked=1`);
  }

  // 4b. Paid session: send them to Stripe Checkout. The money goes to the coach's Stripe account.
  let checkoutUrl: string | null = null;
  try {
    const when = `${formatSlotDate(slot.start, { long: true })}, ${formatSlotTime(slot.start)}–${formatSlotTime(slot.end)} (UK time)`;
    const session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        customer_email: user.email,
        client_reference_id: bookingId,
        metadata: { booking_id: bookingId },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "gbp",
              unit_amount: service.price_pence,
              product_data: { name: `${service.name} with ${coach.business_name}`, description: `${when} · for ${playerName}` },
            },
          },
        ],
        payment_intent_data: {
          metadata: { booking_id: bookingId },
          description: `${service.name} – ${when}`,
          ...(fee > 0 ? { application_fee_amount: fee } : {}),
        },
        expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
        success_url: `${siteUrl()}/parent/bookings/${bookingId}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl()}/parent/bookings/${bookingId}?cancelled=1`,
      },
      { stripeAccount: coach.stripe_account_id!, idempotencyKey: `checkout-${bookingId}` },
    );
    await admin.from("bookings").update({ stripe_checkout_session_id: session.id }).eq("id", bookingId);
    checkoutUrl = session.url;
  } catch (e) {
    console.error("checkout create failed", e);
    await cancelBooking(bookingId, "system");
    return { error: "We couldn't start the payment. Please try again." };
  }
  redirect(checkoutUrl!);
}
