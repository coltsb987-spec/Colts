import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { InlineAction } from "@/components/action-form";
import { BookingStatusBadge } from "@/components/booking-status";
import { Card, PageHeader } from "@/components/ui";
import { getMyCoach } from "@/lib/auth";
import { summariseEarnings } from "@/lib/earnings";
import { formatPrice } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatSlotDate, formatSlotTime, londonDate } from "@/lib/slots";
import { coachCancelBooking } from "./actions";

export const metadata: Metadata = { title: "Bookings" };

type Row = {
  id: string; start_at: string; end_at: string; status: string; payment_status: string; price_pence: number; platform_fee_pence: number;
  hold_expires_at: string | null; source: string; booked_by_profile_id: string | null;
  services: { name: string } | null; players: { first_name: string; age_group: string; notes: string | null } | null;
};

export default async function CoachBookings({ searchParams }: { searchParams: Promise<{ moved?: string }> }) {
  const { coach, supabase } = await getMyCoach();
  if (!coach) redirect("/coach/profile");
  const { moved } = await searchParams;
  const now = new Date();

  // RLS: only this coach's bookings (and the players booked with them).
  const { data } = await supabase
    .from("bookings")
    .select("id, start_at, end_at, status, payment_status, price_pence, platform_fee_pence, hold_expires_at, source, booked_by_profile_id, services(name), players(first_name, age_group, notes)")
    .eq("coach_id", coach.id)
    .order("start_at")
    .returns<Row[]>();
  const rows = data ?? [];
  const earnings = summariseEarnings(rows, now);

  const live = (r: Row) => r.status === "confirmed" || (r.status === "pending" && r.hold_expires_at && Date.parse(r.hold_expires_at) > now.getTime());
  const upcoming = rows.filter((r) => live(r) && Date.parse(r.end_at) >= now.getTime());
  const recent = rows
    .filter((r) => Date.parse(r.end_at) < now.getTime() && Date.parse(r.start_at) > now.getTime() - 30 * 86400_000 && r.status !== "pending")
    .reverse();

  // Parent names + emails for contacting them about their sessions.
  const parentIds = [...new Set(upcoming.map((r) => r.booked_by_profile_id).filter(Boolean))] as string[];
  const admin = createAdminClient();
  const { data: parents } = await admin.from("profiles").select("id, full_name, phone").in("id", parentIds.length ? parentIds : ["00000000-0000-0000-0000-000000000000"]);
  const emails = new Map<string, string>();
  await Promise.all(parentIds.map(async (id) => {
    const { data: u } = await admin.auth.admin.getUserById(id);
    if (u.user?.email) emails.set(id, u.user.email);
  }));

  const byDay = new Map<string, Row[]>();
  for (const r of upcoming) {
    const d = londonDate(new Date(r.start_at));
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }

  return (
    <>
      <PageHeader title="Bookings" description="Your upcoming sessions and what you've earned. Times are UK time." />
      {moved && <p className="mb-4 rounded-xl bg-lime px-4 py-3 font-medium">Session moved. We&apos;ve emailed the parent the new time.</p>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["This month", earnings.thisMonth],
          ["Last month", earnings.lastMonth],
          ["Booked ahead", earnings.upcoming],
          ["All time", earnings.allTime],
        ].map(([label, pence]) => (
          <Card key={label as string} className="p-4 sm:p-4">
            <p className="text-sm text-ink-soft">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatPrice(pence as number).replace("Free", "£0")}</p>
          </Card>
        ))}
      </div>
      <p className="-mt-3 mb-6 text-xs text-ink-soft">Paid sessions only, before Stripe&apos;s card fees. Stripe pays this into your bank.</p>

      <h2 className="mb-3 text-lg font-semibold">Upcoming</h2>
      {upcoming.length === 0 ? (
        <Card className="bg-white/50"><p className="text-ink-soft">No upcoming sessions yet. Share your booking link to get your first booking.</p></Card>
      ) : (
        <div className="space-y-6">
          {[...byDay.entries()].map(([day, list]) => (
            <section key={day}>
              <h3 className="mb-2 text-sm font-semibold text-ink-soft">{formatSlotDate(list[0].start_at, { long: true })}</h3>
              <ul className="space-y-2">
                {list.map((r) => {
                  const parent = parents?.find((p) => p.id === r.booked_by_profile_id);
                  const email = r.booked_by_profile_id ? emails.get(r.booked_by_profile_id) : undefined;
                  return (
                    <li key={r.id}>
                      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                        <div className="min-w-0">
                          <p className="font-semibold">
                            <span className="tabular-nums">{formatSlotTime(r.start_at)}–{formatSlotTime(r.end_at)}</span> · {r.services?.name}
                          </p>
                          <p className="text-sm text-ink-soft">
                            {r.players ? `${r.players.first_name} (${r.players.age_group})` : "Player"}
                            {parent?.full_name && ` · parent ${parent.full_name}`}
                            {email && <> · <a className="underline" href={`mailto:${email}`}>{email}</a></>}
                            {parent?.phone && ` · ${parent.phone}`}
                          </p>
                          {r.players?.notes && <p className="mt-1 text-sm">“{r.players.notes}”</p>}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <BookingStatusBadge status={r.status} payment={r.payment_status} />
                          {r.status === "confirmed" && (
                            <>
                              <Link href={`/coach/bookings/${r.id}/reschedule`} className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-white hover:text-ink">Move</Link>
                              <InlineAction
                                action={coachCancelBooking.bind(null, r.id)}
                                label="Cancel"
                                confirm={r.payment_status === "paid" ? `Cancel this session and refund ${formatPrice(r.price_pence)} to the parent?` : "Cancel this session?"}
                              />
                            </>
                          )}
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-lg font-semibold">Last 30 days ({recent.length})</summary>
          <ul className="mt-3 space-y-2">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sage-line/80 bg-white/70 px-4 py-2 text-sm">
                <span>{formatSlotDate(r.start_at)} {formatSlotTime(r.start_at)} · {r.services?.name} · {r.players?.first_name ?? "Player"}</span>
                <BookingStatusBadge status={r.status} payment={r.payment_status} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
