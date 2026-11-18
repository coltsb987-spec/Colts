import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { SlotPicker } from "@/components/slot-picker";
import { Card, PageHeader } from "@/components/ui";
import { getMyCoach } from "@/lib/auth";
import { getSlots, loadCoach } from "@/lib/bookings";
import { formatSlotDate, formatSlotTime } from "@/lib/slots";
import type { Service } from "@/lib/types";
import { coachRescheduleBooking } from "../../actions";

export const metadata: Metadata = { title: "Move session" };

export default async function ReschedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { coach, supabase } = await getMyCoach();
  if (!coach) redirect("/coach/profile");

  const { data: b } = await supabase
    .from("bookings")
    .select("id, start_at, end_at, status, services(*), players(first_name)")
    .eq("id", id)
    .eq("coach_id", coach.id)
    .maybeSingle<{ id: string; start_at: string; end_at: string; status: string; services: Service; players: { first_name: string } | null }>();
  if (!b || b.status !== "confirmed") notFound();

  const full = await loadCoach(coach.id);
  const days = await getSlots(b.services, { ...full!, booking_notice_hours: 0 }, { excludeBookingId: b.id });

  return (
    <>
      <Link href="/coach/bookings" className="text-sm text-ink-soft hover:text-ink">← Bookings</Link>
      <PageHeader
        title="Move session"
        description={`${b.services.name} for ${b.players?.first_name ?? "player"}, currently ${formatSlotDate(b.start_at, { long: true })} at ${formatSlotTime(b.start_at)}. The parent will be emailed the new time.`}
      />
      <Card>
        <ActionForm action={coachRescheduleBooking.bind(null, b.id)} submitLabel="Move to this time" pendingLabel="Moving…">
          <SlotPicker days={days} showSpots={b.services.type !== "one_to_one"} />
        </ActionForm>
      </Card>
    </>
  );
}
