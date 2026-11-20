import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getMyCoach } from "@/lib/auth";
import { receptionistStatus } from "@/lib/receptionist/activation";
import { isReceptionistConfigured } from "@/lib/receptionist/run";
import { defaultGreeting } from "@/lib/receptionist/settings";
import { ReceptionistSettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "AI receptionist" };

export default async function ReceptionistPage() {
  const { coach, supabase } = await getMyCoach();
  if (!coach) redirect("/coach/profile");
  const status = await receptionistStatus(supabase, coach.id);
  const { settings } = status;

  return (
    <>
      <PageHeader
        title="AI receptionist"
        description="An assistant on your booking page that answers parents, checks your times and takes bookings – day and night."
        action={status.state === "live" ? <Badge tone="accent">Live</Badge> : status.state === "paused" ? <Badge tone="muted">Paused</Badge> : <Badge tone="muted">Not live yet</Badge>}
      />
      <Card className="mb-4 bg-white/60" aria-live="polite">
        {status.state === "live" ? (
          <p className="font-medium">
            Your receptionist is live{status.published ? " on your booking page" : " – it will appear on your page as soon as you publish it"}.
            {status.published && <> <Link href={`/${coach.slug}`} target="_blank" className="underline underline-offset-4">See it</Link></>}
          </p>
        ) : status.state === "paused" ? (
          <p className="font-medium">Your receptionist is paused. Untick &ldquo;Pause my receptionist&rdquo; below and press Save to switch it back on.</p>
        ) : (
          <>
            <p className="font-medium">Your receptionist switches on by itself once these are done:</p>
            <ul className="mt-2 space-y-1 text-sm">
              {[
                { label: "Your profile", href: "/coach/profile", done: true },
                { label: "At least one session", href: "/coach/services", done: !status.missing.some((m) => m.href === "/coach/services") },
                { label: "Your weekly hours", href: "/coach/availability", done: !status.missing.some((m) => m.href === "/coach/availability") },
                { label: "These receptionist settings – press Save below", href: "#settings", done: Boolean(settings.saved_at) },
              ].map((step) => (
                <li key={step.label} className="flex items-center gap-2">
                  <span aria-hidden className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${step.done ? "bg-ink text-lime" : "border border-ink/30 bg-white"}`}>{step.done ? "✓" : ""}</span>
                  {step.done ? <span className="text-ink-soft line-through decoration-ink/30">{step.label}</span> : <Link href={step.href} className="font-medium underline underline-offset-4">{step.label}</Link>}
                  <span className="sr-only">{step.done ? "(done)" : "(to do)"}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {!isReceptionistConfigured() && (
        <p className="mb-4 rounded-xl border border-sage-line bg-white px-4 py-3 text-sm">
          The AI service isn&apos;t connected yet, so the chat won&apos;t show on your page even if switched on.
        </p>
      )}
      <Card id="settings">
        <ReceptionistSettingsForm settings={settings} defaultGreeting={defaultGreeting(coach.business_name)} />
      </Card>
      <p className="mt-4 text-sm text-ink-soft">
        Conversations appear in <Link href="/coach/messages" className="font-medium text-ink underline underline-offset-4">Messages</Link>. You&apos;ll get an email when one needs you.
        {coach.published && <> Try it on <Link href={`/${coach.slug}`} target="_blank" className="font-medium text-ink underline underline-offset-4">your page</Link>.</>}
      </p>
    </>
  );
}
