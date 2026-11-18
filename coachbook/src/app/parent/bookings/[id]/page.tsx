import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingStatusBadge } from "@/components/booking-status";
import { ButtonLink, Card } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { cancelBooking, confirmBooking, getBookingDetails } from "@/lib/bookings";
import { formatPrice } from "@/lib/format";
import { getUserEmail } from "@/lib/supabase/admin";
import { formatSlotDate, formatSlotTime } from "@/lib/slots";
import { stripe } from "@/lib/stripe";

export const metadata: Metadata = { title: "Booking" };

export default async function ParentBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session_id?: string; cancelled?: string; booked?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, user } = await requireRole("parent");

  // RLS check: is this the parent's booking?
  const { data: mine } = await supabase.from("bookings").select("id").eq("id", id).eq("booked_by_profile_id", user.id).maybeSingle();
  if (!mine) notFound();

  let b = await getBookingDetails(id);
  if (!b) notFound();
  let notice: string | null = null;

  // Back from Stripe: confirm straight away (the webhook does the same, whichever comes first).
  if (b.status === "pending" && sp.session_id && sp.session_id === b.stripe_checkout_session_id && b.coaches?.stripe_account_id) {
    const session = await stripe().checkout.sessions.retrieve(sp.session_id, {}, { stripeAccount: b.coaches.stripe_account_id });
    if (session.payment_status === "paid") {
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
      await confirmBooking(id, pi, true);
      b = (await getBookingDetails(id))!;
    }
  }
  // Left Stripe without paying: release the slot.
  if (b.status === "pending" && sp.cancelled) {
    await cancelBooking(id, "parent");
    b = (await getBookingDetails(id))!;
    notice = "Payment cancelled – nothing was charged and the time has been released.";
  }

  const coachEmail = b.status === "confirmed" ? await getUserEmail(b.coaches?.profile_id) : null;
  const justBooked = b.status === "confirmed" && (sp.session_id || sp.booked);

  return (
    <div className="mx-auto max-w-2xl">
      {justBooked && <p className="mb-4 rounded-xl bg-lime px-4 py-3 font-medium">You&apos;re booked in! We&apos;ve emailed you the details.</p>}
      {notice && <p className="mb-4 rounded-xl border border-sage-line bg-white px-4 py-3">{notice}</p>}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{b.services?.name}</h1>
            <p className="text-ink-soft">with {b.coaches?.business_name}</p>
          </div>
          <BookingStatusBadge status={b.status} payment={b.payment_status} />
        </div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-ink-soft">When (UK time)</dt><dd className="font-medium">{formatSlotDate(b.start_at, { long: true })}, {formatSlotTime(b.start_at)}–{formatSlotTime(b.end_at)}</dd></div>
          <div><dt className="text-ink-soft">Player</dt><dd className="font-medium">{b.players?.first_name ?? "—"} {b.players?.age_group && `(${b.players.age_group})`}</dd></div>
          <div><dt className="text-ink-soft">Where</dt><dd className="font-medium">{b.services?.location ?? "Your coach will confirm"}</dd></div>
          <div><dt className="text-ink-soft">Price</dt><dd className="font-medium">{formatPrice(b.price_pence)}</dd></div>
        </dl>
        {b.status === "confirmed" && (
          <p className="mt-5 text-sm text-ink-soft">
            Need to change or cancel? Contact {b.coaches?.business_name}
            {coachEmail && <> at <a className="font-medium text-ink underline" href={`mailto:${coachEmail}`}>{coachEmail}</a></>}.
          </p>
        )}
        {b.status === "cancelled" && b.coaches?.slug && (
          <ButtonLink href={`/${b.coaches.slug}`} className="mt-5">Book another time</ButtonLink>
        )}
      </Card>
    </div>
  );
}
