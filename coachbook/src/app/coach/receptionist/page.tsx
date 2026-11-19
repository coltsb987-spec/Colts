import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getMyCoach } from "@/lib/auth";
import { isReceptionistConfigured } from "@/lib/receptionist/run";
import { defaultGreeting, readSettings } from "@/lib/receptionist/settings";
import { ReceptionistSettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "AI receptionist" };

export default async function ReceptionistPage() {
  const { coach, supabase } = await getMyCoach();
  if (!coach) redirect("/coach/profile");
  const { data } = await supabase.from("coaches").select("receptionist_settings").eq("id", coach.id).single();
  const settings = readSettings(data?.receptionist_settings);

  return (
    <>
      <PageHeader
        title="AI receptionist"
        description="An assistant on your booking page that answers parents, checks your times and takes bookings – day and night."
        action={settings.enabled ? <Badge tone="accent">On</Badge> : <Badge tone="muted">Off</Badge>}
      />
      {!isReceptionistConfigured() && (
        <p className="mb-4 rounded-xl border border-sage-line bg-white px-4 py-3 text-sm">
          The AI service isn&apos;t connected yet, so the chat won&apos;t show on your page even if switched on.
        </p>
      )}
      <Card>
        <ReceptionistSettingsForm settings={settings} defaultGreeting={defaultGreeting(coach.business_name)} />
      </Card>
      <p className="mt-4 text-sm text-ink-soft">
        Conversations appear in <Link href="/coach/messages" className="font-medium text-ink underline underline-offset-4">Messages</Link>. You&apos;ll get an email when one needs you.
        {coach.published && <> Try it on <Link href={`/${coach.slug}`} target="_blank" className="font-medium text-ink underline underline-offset-4">your page</Link>.</>}
      </p>
    </>
  );
}
