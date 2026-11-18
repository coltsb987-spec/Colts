import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Logo } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { bookability, getSlots, loadCoachBySlug } from "@/lib/bookings";
import { formatDuration, formatPrice, SERVICE_TYPE_LABELS } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Service } from "@/lib/types";
import { createBooking } from "./actions";
import { BookingForm } from "./booking-form";

export const metadata: Metadata = { title: "Book a session" };

export default async function BookPage({ params }: { params: Promise<{ slug: string; serviceId: string }> }) {
  const { slug, serviceId } = await params;
  if (!/^[a-z0-9-]{3,50}$/.test(slug) || !/^[0-9a-f-]{36}$/.test(serviceId)) notFound();

  const coach = await loadCoachBySlug(slug);
  if (!coach || !coach.published) notFound();
  const { data: service } = await createAdminClient().from("services").select("*").eq("id", serviceId).eq("coach_id", coach.id).maybeSingle<Service>();
  if (!service) notFound();

  const { supabase, user } = await requireRole("parent", `/${slug}/book/${serviceId}`);
  const can = bookability(coach, service);
  const [{ data: players }, days] = await Promise.all([
    supabase.from("players").select("id, first_name, age_group").eq("parent_profile_id", user.id).order("created_at"),
    can.ok ? getSlots(service, coach) : Promise.resolve([]),
  ]);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <Logo />
        <Link href="/parent/bookings" className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-sage hover:text-ink">My bookings</Link>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <Link href={`/${slug}`} className="text-sm text-ink-soft hover:text-ink">← {coach.business_name}</Link>
        <div className="mt-2 mb-6">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{service.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-ink-soft">
            <Badge>{SERVICE_TYPE_LABELS[service.type]}</Badge>
            {formatDuration(service.duration_minutes)} · {formatPrice(service.price_pence)}
            {service.type !== "one_to_one" && service.price_pence > 0 && " per player"}
            {service.location && ` · ${service.location}`}
          </p>
        </div>
        <Card>
          {can.ok ? (
            <BookingForm
              action={createBooking.bind(null, slug, serviceId)}
              days={days}
              players={players ?? []}
              isGroup={service.type !== "one_to_one"}
              payLabel={service.price_pence > 0 ? `Continue to payment · ${formatPrice(service.price_pence)}` : "Confirm booking"}
            />
          ) : (
            <p>{can.reason}</p>
          )}
        </Card>
        <p className="mt-4 text-xs text-ink-soft">
          Times are UK time. Payments are taken securely by Stripe and go directly to {coach.business_name}, an independent coach.
        </p>
      </main>
    </div>
  );
}
