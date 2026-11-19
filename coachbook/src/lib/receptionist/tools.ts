import "server-only";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  bookability,
  cancelBooking,
  createParentBooking,
  getSlots,
  parentChangeAllowed,
  rescheduleBooking,
  type BookingCoach,
} from "@/lib/bookings";
import { emailLayout, sendEmail } from "@/lib/email";
import { formatDuration, formatPrice, SERVICE_TYPE_LABELS } from "@/lib/format";
import { siteUrl } from "@/lib/site";
import { findSlot, formatSlotDate, formatSlotTime, londonDate } from "@/lib/slots";
import { createAdminClient, getUserEmail } from "@/lib/supabase/admin";
import type { Service } from "@/lib/types";
import type { ReceptionistSettings } from "./settings";

/** Buttons the chat widget shows under the AI's reply (e.g. "Pay £35"). */
export type ReceptionistAction = { type: "pay" | "link"; label: string; url: string };

export type ToolContext = {
  coach: BookingCoach;
  settings: ReceptionistSettings;
  conversationId: string;
  /** Set only when the visitor is signed in as a parent (checked from their session cookie). */
  parent: { id: string; email: string | undefined; name: string | null } | null;
  actions: ReceptionistAction[];
  handedOff: boolean;
};

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i, "must be an id from a previous tool result");
const json = (v: unknown) => JSON.stringify(v);
const whenText = (start: string, end: string) => `${formatSlotDate(start, { long: true })}, ${formatSlotTime(start)}–${formatSlotTime(end)}`;

async function activeServices(coachId: string): Promise<Service[]> {
  const { data } = await createAdminClient().from("services").select("*").eq("coach_id", coachId).eq("active", true).order("price_pence");
  return (data ?? []) as Service[];
}

async function serviceFor(ctx: ToolContext, serviceId: string): Promise<Service | null> {
  const { data } = await createAdminClient().from("services").select("*").eq("id", serviceId).eq("coach_id", ctx.coach.id).eq("active", true).maybeSingle<Service>();
  return data;
}

/** A booking that belongs to the signed-in parent AND this coach. */
async function myBooking(ctx: ToolContext, bookingId: string) {
  if (!ctx.parent) return null;
  const { data } = await createAdminClient()
    .from("bookings")
    .select("id, service_id, start_at, end_at, status, payment_status, hold_expires_at")
    .eq("id", bookingId)
    .eq("coach_id", ctx.coach.id)
    .eq("booked_by_profile_id", ctx.parent.id)
    .maybeSingle();
  return data;
}

const notSignedIn = () =>
  json({ error: "not_signed_in", message: "The person must sign in as a parent on this page first (Sign in link at the top of the page)." });

/** Wraps a tool so any unexpected failure comes back to the model as an error result. */
function safe<T>(fn: (input: T) => Promise<string>) {
  return async (input: T) => {
    try {
      return await fn(input);
    } catch (e) {
      console.error("receptionist tool failed", e);
      return json({ error: "tool_failed", message: "Something went wrong on our side. Apologise and offer to pass this to the coach." });
    }
  };
}

export function receptionistTools(ctx: ToolContext) {
  const getServices = betaZodTool({
    name: "get_services",
    description: "List the coach's bookable sessions with their ids, type, length, price, location and description.",
    inputSchema: z.object({}),
    run: safe(async () => {
      const services = await activeServices(ctx.coach.id);
      return json({
        services: services.map((s) => ({
          service_id: s.id,
          name: s.name,
          type: SERVICE_TYPE_LABELS[s.type],
          length: formatDuration(s.duration_minutes),
          price: s.price_pence === 0 ? "Free" : `${formatPrice(s.price_pence)}${s.type === "one_to_one" ? "" : " per player"}`,
          max_players: s.max_participants,
          location: s.location,
          description: s.description,
          can_book_online: bookability(ctx.coach, s).ok,
        })),
      });
    }),
  });

  const checkAvailability = betaZodTool({
    name: "check_availability",
    description:
      "Find free start times for one session over the next few days (UK time). Use the 'start' value exactly as returned when booking or moving a session.",
    inputSchema: z.object({
      service_id: uuid,
      from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("First day to check, YYYY-MM-DD. Defaults to today."),
      days: z.number().int().min(1).max(14).optional().describe("How many days to check (default 7)."),
    }),
    run: safe(async ({ service_id, from_date, days = 7 }) => {
      const service = await serviceFor(ctx, service_id);
      if (!service) return json({ error: "unknown_service" });
      const from = from_date ?? londonDate(new Date());
      const all = await getSlots(service, ctx.coach);
      const picked = all.filter((d) => d.date >= from).slice(0, days);
      return json({
        service: service.name,
        days: picked.map((d) => ({
          date: formatSlotDate(d.slots[0].start, { long: true }),
          times: d.slots.slice(0, 12).map((s) => ({
            start: s.start,
            time: formatSlotTime(s.start),
            ...(service.type !== "one_to_one" ? { places_left: s.spotsLeft } : {}),
          })),
          ...(d.slots.length > 12 ? { more_times_available: d.slots.length - 12 } : {}),
        })),
        note: picked.length === 0 ? "No free times in this range (bookings open up to 4 weeks ahead)." : undefined,
      });
    }),
  });

  const createBooking = betaZodTool({
    name: "create_booking",
    description:
      "Book a session at a free time from check_availability. For paid sessions this returns a secure payment link that holds the time for 30 minutes. If the person isn't signed in, it returns a link where they sign in and finish booking. Use player_id for a saved player, or new_player for someone new (first name and age group only).",
    inputSchema: z.object({
      service_id: uuid,
      start: z.string().describe("The exact 'start' value from check_availability."),
      player_id: uuid.optional(),
      new_player: z
        .object({
          first_name: z.string().trim().min(1).max(50),
          age_group: z.string().trim().min(1).max(20).describe("e.g. U9, U12, Adult"),
        })
        .optional(),
      parent_consent: z.boolean().optional().describe("True only if the adult clearly agreed in this chat (needed for a new player)."),
    }),
    run: safe(async (input) => {
      const service = await serviceFor(ctx, input.service_id);
      if (!service) return json({ error: "unknown_service" });
      const can = bookability(ctx.coach, service);
      if (!can.ok) return json({ error: "not_bookable", message: can.reason });
      if (Number.isNaN(Date.parse(input.start))) return json({ error: "bad_start" });
      const slot = findSlot(await getSlots(service, ctx.coach), input.start);
      if (!slot) return json({ error: "time_not_available", message: "That time isn't free any more. Check availability again." });

      if (!ctx.parent) {
        const url = `${siteUrl()}/${ctx.coach.slug}/book/${service.id}?start=${encodeURIComponent(slot.start)}`;
        ctx.actions.push({ type: "link", label: "Sign in and book", url });
        return json({
          status: "sign_in_needed",
          booking_link: url,
          message: "Share this link. They sign in with their email, confirm the player and pay. The time isn't held until they do.",
        });
      }

      const admin = createAdminClient();
      let playerId = input.player_id;
      let playerName = "";
      if (playerId) {
        const { data } = await admin.from("players").select("id, first_name").eq("id", playerId).eq("parent_profile_id", ctx.parent.id).maybeSingle();
        if (!data) return json({ error: "unknown_player" });
        playerName = data.first_name;
      } else if (input.new_player) {
        if (input.parent_consent !== true)
          return json({ error: "consent_needed", message: "Ask the adult to confirm they're the parent/guardian and agree to the details being stored and shared with the coach." });
        const { data, error } = await admin
          .from("players")
          .insert({ parent_profile_id: ctx.parent.id, ...input.new_player, parental_consent_at: new Date().toISOString() })
          .select("id, first_name")
          .single();
        if (error || !data) return json({ error: "could_not_save_player" });
        playerId = data.id;
        playerName = data.first_name;
      } else {
        return json({ error: "player_needed", message: "Ask which player this is for (call list_my_players for saved players)." });
      }

      const result = await createParentBooking({
        coach: ctx.coach,
        service,
        start: slot.start,
        playerId: playerId!,
        playerName,
        parentId: ctx.parent.id,
        parentEmail: ctx.parent.email,
        source: "ai_receptionist",
      });
      if (!result.ok) return json({ error: "booking_failed", message: result.error });
      if (result.checkoutUrl) {
        ctx.actions.push({ type: "pay", label: `Pay ${formatPrice(service.price_pence)}`, url: result.checkoutUrl });
        return json({
          status: "awaiting_payment",
          booking_id: result.bookingId,
          when: whenText(result.start, result.end),
          payment_link: result.checkoutUrl,
          message: "Held for 30 minutes. It's confirmed once they pay with this link (a Pay button also appears in the chat).",
        });
      }
      ctx.actions.push({ type: "link", label: "View booking", url: `${siteUrl()}/parent/bookings/${result.bookingId}` });
      return json({ status: "confirmed", booking_id: result.bookingId, when: whenText(result.start, result.end), message: "Free session booked. A confirmation email is on its way." });
    }),
  });

  const listMyPlayers = betaZodTool({
    name: "list_my_players",
    description: "List the signed-in parent's saved players (first name and age group).",
    inputSchema: z.object({}),
    run: safe(async () => {
      if (!ctx.parent) return notSignedIn();
      const { data } = await createAdminClient().from("players").select("id, first_name, age_group").eq("parent_profile_id", ctx.parent.id).order("created_at");
      return json({ players: (data ?? []).map((p) => ({ player_id: p.id, first_name: p.first_name, age_group: p.age_group })) });
    }),
  });

  const listMyBookings = betaZodTool({
    name: "list_my_bookings",
    description: "List the signed-in parent's upcoming bookings with this coach, and whether each can still be cancelled or moved online.",
    inputSchema: z.object({}),
    run: safe(async () => {
      if (!ctx.parent) return notSignedIn();
      const now = new Date();
      const { data } = await createAdminClient()
        .from("bookings")
        .select("id, start_at, end_at, status, payment_status, hold_expires_at, services(name), players(first_name)")
        .eq("coach_id", ctx.coach.id)
        .eq("booked_by_profile_id", ctx.parent.id)
        .in("status", ["confirmed", "pending"])
        .gte("start_at", now.toISOString())
        .order("start_at")
        .returns<{ id: string; start_at: string; end_at: string; status: string; payment_status: string; hold_expires_at: string | null; services: { name: string } | null; players: { first_name: string } | null }[]>();
      const live = (data ?? []).filter((b) => b.status === "confirmed" || (b.hold_expires_at && Date.parse(b.hold_expires_at) > now.getTime()));
      return json({
        bookings: live.map((b) => ({
          booking_id: b.id,
          session: b.services?.name,
          player: b.players?.first_name,
          when: whenText(b.start_at, b.end_at),
          status: b.status === "pending" ? "awaiting payment" : b.payment_status === "paid" ? "confirmed and paid" : "confirmed",
          can_cancel_or_move_online: parentChangeAllowed(b.start_at, ctx.settings.cancellation_notice_hours, now),
        })),
        rule: `Online changes allowed up to ${ctx.settings.cancellation_notice_hours} hours before the start.`,
      });
    }),
  });

  const cancel = betaZodTool({
    name: "cancel_booking",
    description: "Cancel one of the signed-in parent's bookings (full refund if paid). Confirm with them before calling.",
    inputSchema: z.object({ booking_id: uuid }),
    run: safe(async ({ booking_id }) => {
      if (!ctx.parent) return notSignedIn();
      const b = await myBooking(ctx, booking_id);
      if (!b || !["confirmed", "pending"].includes(b.status)) return json({ error: "booking_not_found" });
      if (b.status === "confirmed" && !parentChangeAllowed(b.start_at, ctx.settings.cancellation_notice_hours))
        return json({ error: "too_late", message: `Online cancellations close ${ctx.settings.cancellation_notice_hours} hours before the start. Offer to pass this to the coach.` });
      const res = await cancelBooking(booking_id, "parent");
      if (!res.ok) return json({ error: "cancel_failed", message: res.error });
      return json({ status: "cancelled", refunded: res.refunded, message: res.refunded ? "Full refund issued (usually 5–10 working days)." : "Cancelled." });
    }),
  });

  const reschedule = betaZodTool({
    name: "reschedule_booking",
    description: "Move one of the signed-in parent's confirmed bookings to a new free time from check_availability. Confirm the new time with them first.",
    inputSchema: z.object({ booking_id: uuid, new_start: z.string().describe("The exact 'start' value from check_availability.") }),
    run: safe(async ({ booking_id, new_start }) => {
      if (!ctx.parent) return notSignedIn();
      const b = await myBooking(ctx, booking_id);
      if (!b || b.status !== "confirmed") return json({ error: "booking_not_found" });
      if (!parentChangeAllowed(b.start_at, ctx.settings.cancellation_notice_hours))
        return json({ error: "too_late", message: `Online changes close ${ctx.settings.cancellation_notice_hours} hours before the start. Offer to pass this to the coach.` });
      const service = await serviceFor(ctx, b.service_id);
      if (!service) return json({ error: "session_no_longer_offered" });
      const slot = findSlot(await getSlots(service, ctx.coach, { excludeBookingId: b.id }), new_start);
      if (!slot) return json({ error: "time_not_available" });
      const res = await rescheduleBooking(b.id, slot.start);
      if (!res.ok) return json({ error: "move_failed", message: res.error });
      return json({ status: "moved", when: whenText(slot.start, slot.end), message: "Moved. A confirmation email is on its way." });
    }),
  });

  const answerFaq = betaZodTool({
    name: "answer_faq",
    description: "Read the coach's own answers to common questions (kit, weather, refunds, ages, parking, etc.). Call this before answering any general question.",
    inputSchema: z.object({ question: z.string().max(300).describe("The question you're trying to answer.") }),
    run: safe(async () =>
      json({
        faqs: ctx.settings.faqs,
        note: ctx.settings.faqs.length ? "Answer only from these. If none fit, say you're not sure and offer to ask the coach." : "The coach hasn't added any answers yet. Offer to pass the question to the coach.",
      }),
    ),
  });

  const handOff = betaZodTool({
    name: "hand_off_to_coach",
    description: "Flag this conversation for the coach to answer personally and email them. Include a short reason. Add the person's name and email if they gave them, so the coach can reply.",
    inputSchema: z.object({
      reason: z.string().trim().min(3).max(500),
      contact_name: z.string().trim().max(120).optional(),
      contact_email: z.email().max(254).optional(),
    }),
    run: safe(async ({ reason, contact_name, contact_email }) => {
      const admin = createAdminClient();
      await admin
        .from("conversations")
        .update({
          needs_handoff: true,
          handoff_reason: reason,
          ...(contact_name ? { contact_name } : {}),
          ...(contact_email ? { contact_email } : {}),
        })
        .eq("id", ctx.conversationId);
      if (!ctx.handedOff) {
        const coachEmail = await getUserEmail(ctx.coach.profile_id);
        const who = contact_name ?? ctx.parent?.name ?? "A visitor";
        await sendEmail({
          to: coachEmail,
          replyTo: contact_email ?? ctx.parent?.email ?? null,
          subject: `Your receptionist needs you: ${reason.slice(0, 60)}`,
          ...emailLayout({
            heading: "A conversation needs your reply",
            lines: [`${who} is chatting on your booking page.`, `Why: ${reason}`, contact_email ? `Their email: ${contact_email}` : "They didn't leave an email – you can reply in your Messages page."],
            cta: { label: "Open the conversation", url: `${siteUrl()}/coach/messages/${ctx.conversationId}` },
          }),
        });
      }
      ctx.handedOff = true;
      return json({ status: "handed_off", message: "The coach has been notified and will reply. Tell the person, and that replies appear here or by email if they left one." });
    }),
  });

  return [getServices, checkAvailability, createBooking, listMyPlayers, listMyBookings, cancel, reschedule, answerFaq, handOff];
}
