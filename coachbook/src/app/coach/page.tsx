import type { Metadata } from "next";
import Link from "next/link";
import { InlineAction } from "@/components/action-form";
import { CopyLink } from "@/components/copy-link";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { getMyCoach } from "@/lib/auth";
import { receptionistStatus } from "@/lib/receptionist/activation";
import { setPublished } from "./actions";

export const metadata: Metadata = { title: "Coach dashboard" };

export default async function CoachHome({ searchParams }: { searchParams: Promise<{ password?: string }> }) {
  const { supabase, coach, profile } = await getMyCoach();
  const passwordBanner = (await searchParams).password === "updated" && (
    <p className="mb-4 rounded-xl bg-lime px-4 py-3 font-medium">Your password has been updated.</p>
  );

  if (!coach) {
    return (
      <>
        {passwordBanner}
        <PageHeader
          title={`Welcome${profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}`}
          description="Let's get your booking page ready. It takes about five minutes."
        />
        <Card>
          <h2 className="text-lg font-semibold">Step 1: your coaching profile</h2>
          <p className="mt-1 text-ink-soft">
            Paste a few lines about your coaching (or a link to your website) and our AI will draft your profile, sessions and hours for
            you to check. Or fill it in yourself.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href="/coach/setup">Fill my profile for me</ButtonLink>
            <ButtonLink href="/coach/profile" variant="secondary">Set up by hand</ButtonLink>
          </div>
        </Card>
      </>
    );
  }

  const [{ count: services }, { count: rules }, { count: upcoming }] = await Promise.all([
    supabase.from("services").select("id", { count: "exact", head: true }).eq("coach_id", coach.id).eq("active", true),
    supabase.from("availability_rules").select("id", { count: "exact", head: true }).eq("coach_id", coach.id),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("coach_id", coach.id).eq("status", "confirmed").gte("start_at", new Date().toISOString()),
  ]);

  const receptionist = await receptionistStatus(supabase, coach.id);
  const steps = [
    { done: true, label: "Create your profile", href: "/coach/profile" },
    { done: Boolean(coach.photo_url && coach.bio), label: "Add a photo and bio", href: "/coach/profile" },
    { done: Boolean(services), label: "Add sessions and prices", href: "/coach/services" },
    { done: Boolean(rules), label: "Set your weekly availability", href: "/coach/availability" },
    { done: coach.stripe_charges_enabled, label: "Connect Stripe to get paid", href: "/coach/payments" },
    { done: receptionist.state === "live", label: receptionist.state === "paused" ? "AI receptionist (paused)" : "Switch on your AI receptionist", href: "/coach/receptionist" },
    { done: coach.published, label: "Publish your booking page", href: "/coach" },
  ];
  const ready = Boolean(services && rules);

  return (
    <>
      {passwordBanner}
      <PageHeader title={coach.business_name} description="Your booking page and setup at a glance." />

      <div className="grid gap-4 md:grid-cols-5">
        <Card className="md:col-span-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Your booking page</h2>
            {coach.published ? <Badge tone="accent">Live</Badge> : <Badge tone="muted">Hidden</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {coach.published
              ? "Share this link with parents and players – on WhatsApp, Instagram or your club's group."
              : ready
                ? "Everything's in place. Publish when you're ready for parents to see it."
                : "Finish the steps on the right, then publish."}
          </p>
          <div className="mt-4">
            <CopyLink path={`/${coach.slug}`} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {coach.published ? (
              <InlineAction action={setPublished.bind(null, false)} label="Hide page" variant="secondary" confirm="Hide your booking page? Parents won't be able to see it." />
            ) : (
              <InlineAction action={setPublished.bind(null, true)} label="Publish page" variant="primary" />
            )}
            <ButtonLink href={`/${coach.slug}`} variant="secondary" target="_blank">Preview</ButtonLink>
          </div>
        </Card>

        <Card className="md:col-span-2">
          <h2 className="text-lg font-semibold">Setup checklist</h2>
          <ol className="mt-3 space-y-2">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3">
                <span
                  aria-hidden
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${s.done ? "bg-ink text-lime" : "border border-ink/25 bg-white"}`}
                >
                  {s.done ? "✓" : ""}
                </span>
                <Link href={s.href} className={`text-sm ${s.done ? "text-ink-soft line-through decoration-ink/30" : "font-medium hover:underline"}`}>
                  {s.label}
                </Link>
                <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Upcoming sessions</h2>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{upcoming ?? 0}</p>
          <Link href="/coach/bookings" className="mt-2 inline-block text-sm font-medium underline underline-offset-4">See bookings and earnings</Link>
        </Card>
        {!coach.stripe_charges_enabled && (
          <Card className="bg-white/50">
            <h2 className="font-semibold">Get paid online</h2>
            <p className="mt-1 text-sm text-ink-soft">Connect Stripe so parents can book paid sessions. Free sessions can be booked already.</p>
            <ButtonLink href="/coach/payments" variant="secondary" className="mt-3">Set up payments</ButtonLink>
          </Card>
        )}
      </div>
    </>
  );
}
