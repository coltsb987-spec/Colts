import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Badge, Card, Logo } from "@/components/ui";
import { formatDate, formatDuration, formatPrice, formatTime, postcodeArea, SERVICE_TYPE_LABELS, WEEKDAY_ORDER, WEEKDAYS } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { AvailabilityRule, PublicCoach, Service } from "@/lib/types";

const getCoach = cache(async (slug: string) => {
  if (!/^[a-z0-9-]{3,50}$/.test(slug)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("public_coaches").select("*").eq("slug", slug).maybeSingle<PublicCoach>();
  return data;
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const coach = await getCoach((await params).slug);
  if (!coach) return { title: "Coach not found" };
  return { title: `Book ${coach.business_name}`, description: coach.bio?.slice(0, 155) ?? `Book football coaching with ${coach.business_name}.` };
}

export default async function CoachPublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const coach = await getCoach(slug);
  if (!coach) notFound();

  const supabase = await createClient();
  const [{ data: svc }, { data: rul }] = await Promise.all([
    supabase.from("services").select("*").eq("coach_id", coach.id).eq("active", true).order("price_pence"),
    supabase.from("availability_rules").select("*").eq("coach_id", coach.id).order("start_time"),
  ]);
  const services = (svc ?? []) as Service[];
  const rules = (rul ?? []) as AvailabilityRule[];
  const area = postcodeArea(coach.postcode);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
        <Logo />
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-16">
        <section className="flex flex-col gap-5 py-6 sm:flex-row sm:items-center">
          <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-3xl border border-sage-line bg-sage">
            {coach.photo_url ? (
              <Image src={coach.photo_url} alt={coach.business_name} fill sizes="112px" className="object-cover" priority />
            ) : (
              <span className="grid h-full place-items-center text-3xl font-semibold text-ink-soft">{coach.business_name.charAt(0)}</span>
            )}
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{coach.business_name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              {area && <span>Based in {area}</span>}
              {coach.dbs_checked && (
                <Badge>
                  DBS checked{coach.dbs_date ? ` · ${formatDate(coach.dbs_date)}` : ""} (coach-declared)
                </Badge>
              )}
            </div>
          </div>
        </section>

        <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
          <div className="space-y-6">
            <section aria-labelledby="sessions">
              <h2 id="sessions" className="mb-3 text-xl font-semibold">Sessions</h2>
              {services.length === 0 ? (
                <p className="text-ink-soft">No sessions listed yet.</p>
              ) : (
                <ul className="space-y-3">
                  {services.map((s) => (
                    <li key={s.id}>
                      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{s.name}</h3>
                            <Badge>{SERVICE_TYPE_LABELS[s.type]}</Badge>
                          </div>
                          <p className="mt-1 text-sm text-ink-soft">
                            {formatDuration(s.duration_minutes)}
                            {s.type !== "one_to_one" && ` · up to ${s.max_participants} players`}
                            {s.location && ` · ${s.location}`}
                          </p>
                          {s.description && <p className="mt-2 text-sm">{s.description}</p>}
                        </div>
                        <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                          <p className="text-lg font-semibold">
                            {formatPrice(s.price_pence)}
                            {s.type !== "one_to_one" && s.price_pence > 0 && <span className="text-sm font-normal text-ink-soft"> /player</span>}
                          </p>
                          <button disabled className="cursor-not-allowed rounded-full bg-lime/50 px-4 py-2 text-sm font-semibold text-ink/60" title="Online booking is coming soon">
                            Booking soon
                          </button>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {(coach.bio || coach.qualifications) && (
              <section aria-labelledby="about" className="space-y-4">
                <h2 id="about" className="text-xl font-semibold">About</h2>
                {coach.bio && <p className="whitespace-pre-line leading-relaxed">{coach.bio}</p>}
                {coach.qualifications && (
                  <div>
                    <h3 className="font-semibold">Qualifications</h3>
                    <p className="mt-1 whitespace-pre-line text-ink-soft">{coach.qualifications}</p>
                  </div>
                )}
              </section>
            )}
          </div>

          <aside>
            <Card>
              <h2 className="font-semibold">Usual coaching hours</h2>
              <ul className="mt-3 space-y-1.5 text-sm">
                {WEEKDAY_ORDER.map((d) => {
                  const day = rules.filter((r) => r.weekday === d);
                  return (
                    <li key={d} className="flex justify-between gap-3">
                      <span className={day.length ? "font-medium" : "text-ink-soft"}>{WEEKDAYS[d].slice(0, 3)}</span>
                      <span className={`text-right ${day.length ? "" : "text-ink-soft"}`}>
                        {day.length ? day.map((r) => `${formatTime(r.start_time)}–${formatTime(r.end_time)}`).join(", ") : "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-ink-soft">UK time. Online booking and payment is coming soon.</p>
            </Card>
            <p className="mt-4 px-1 text-xs text-ink-soft">
              {coach.business_name} is an independent coach. CoachBook UK provides the booking system and is not the coach&apos;s employer.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
