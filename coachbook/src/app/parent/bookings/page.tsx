import type { Metadata } from "next";
import Link from "next/link";
import { BookingStatusBadge } from "@/components/booking-status";
import { Card, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatPrice } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatSlotDate, formatSlotTime } from "@/lib/slots";

export const metadata: Metadata = { title: "My bookings" };

type Row = {
  id: string; start_at: string; end_at: string; status: string; payment_status: string; price_pence: number; hold_expires_at: string | null;
  service_id: string; coach_id: string; player_id: string | null;
};

export default async function ParentBookings() {
  const { supabase, user } = await requireRole("parent");
  // RLS: only bookings this parent made.
  const { data } = await supabase
    .from("bookings")
    .select("id, start_at, end_at, status, payment_status, price_pence, hold_expires_at, service_id, coach_id, player_id")
    .eq("booked_by_profile_id", user.id)
    .neq("status", "cancelled")
    .order("start_at");
  const rows = (data ?? []) as Row[];
  const now = new Date().getTime();
  const visible = rows.filter((r) => r.status !== "pending" || (r.hold_expires_at && Date.parse(r.hold_expires_at) > now));

  // Names of the services/coaches/players on those bookings (already proven to be the parent's).
  const admin = createAdminClient();
  const [svc, coaches, players] = await Promise.all([
    admin.from("services").select("id, name").in("id", [...new Set(visible.map((r) => r.service_id))]),
    admin.from("coaches").select("id, business_name").in("id", [...new Set(visible.map((r) => r.coach_id))]),
    supabase.from("players").select("id, first_name").eq("parent_profile_id", user.id),
  ]);
  const name = (list: { id: string }[] | null, id: string | null, key: string) =>
    ((list ?? []).find((x) => x.id === id) as Record<string, string> | undefined)?.[key] ?? "";

  const upcoming = visible.filter((r) => Date.parse(r.end_at) >= now);
  const past = visible.filter((r) => Date.parse(r.end_at) < now).reverse();

  const renderList = (items: Row[]) => (
    <ul className="space-y-3">
      {items.map((r) => (
        <li key={r.id}>
          <Link href={`/parent/bookings/${r.id}`} className="block">
            <Card className="flex flex-col gap-2 transition-colors hover:border-ink/30 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{name(svc.data, r.service_id, "name")} · {name(coaches.data, r.coach_id, "business_name")}</p>
                <p className="text-sm text-ink-soft">
                  {formatSlotDate(r.start_at, { long: true })}, {formatSlotTime(r.start_at)}–{formatSlotTime(r.end_at)} · {name(players.data, r.player_id, "first_name")} · {formatPrice(r.price_pence)}
                </p>
              </div>
              <BookingStatusBadge status={r.status} payment={r.payment_status} />
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <PageHeader title="My bookings" description="Your upcoming and past sessions. Times are UK time." />
      {upcoming.length === 0 ? (
        <Card className="bg-white/50">
          <p className="text-ink-soft">No upcoming sessions. Use your coach&apos;s CoachBook link to book.</p>
        </Card>
      ) : (
        renderList(upcoming)
      )}
      {past.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-semibold">Past sessions</h2>
          {renderList(past)}
        </>
      )}
    </>
  );
}
