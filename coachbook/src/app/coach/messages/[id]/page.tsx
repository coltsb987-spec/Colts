import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionForm, InlineAction } from "@/components/action-form";
import { Badge, Card, Textarea } from "@/components/ui";
import { getMyCoach } from "@/lib/auth";
import { replyToConversation, setHandled } from "../actions";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { coach, supabase } = await getMyCoach();
  if (!coach) redirect("/coach/profile");

  const { data: convo } = await supabase
    .from("conversations")
    .select("id, contact_name, contact_email, needs_handoff, handoff_reason, created_at, parent_profile_id")
    .eq("id", id)
    .eq("coach_id", coach.id)
    .maybeSingle();
  if (!convo) notFound();
  const { data: msgs } = await supabase.from("messages").select("id, sender, content, created_at").eq("conversation_id", id).order("created_at");
  await supabase.from("conversations").update({ coach_read_at: new Date().toISOString() }).eq("id", id);

  const time = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/coach/messages" className="text-sm text-ink-soft hover:text-ink">← Messages</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {convo.contact_name ?? "Visitor"} {convo.needs_handoff && <Badge tone="accent">Needs you</Badge>}
          </h1>
          <p className="text-sm text-ink-soft">
            Started {time(convo.created_at)}
            {convo.contact_email && <> · <a className="underline" href={`mailto:${convo.contact_email}`}>{convo.contact_email}</a></>}
            {convo.parent_profile_id ? " · signed-in parent" : ""}
          </p>
          {convo.needs_handoff && convo.handoff_reason && <p className="mt-1 text-sm">Why: {convo.handoff_reason}</p>}
        </div>
        <InlineAction action={setHandled.bind(null, id, convo.needs_handoff)} label={convo.needs_handoff ? "Mark as handled" : "Flag for later"} variant="secondary" />
      </div>

      <Card className="space-y-3 bg-white/60">
        {(msgs ?? []).map((m) => (
          <div key={m.id} className={`flex ${m.sender === "customer" ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.sender === "customer" ? "border border-sage-line bg-white" : m.sender === "coach" ? "bg-ink text-canvas" : "bg-sage"}`}>
              <p className={`mb-0.5 text-xs font-semibold ${m.sender === "coach" ? "text-canvas/80" : "text-ink-soft"}`}>
                {m.sender === "customer" ? convo.contact_name ?? "Visitor" : m.sender === "ai" ? "AI assistant" : "You"} · {time(m.created_at)}
              </p>
              <p className="whitespace-pre-line [overflow-wrap:anywhere]">{m.content}</p>
            </div>
          </div>
        ))}
      </Card>

      <Card className="mt-4">
        <ActionForm action={replyToConversation.bind(null, id)} submitLabel="Send reply" pendingLabel="Sending…" resetOnSuccess>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Reply as {coach.business_name}</span>
            <Textarea name="reply" required maxLength={2000} rows={3} placeholder="Your reply appears in their chat" />
          </label>
          {!convo.contact_email && <p className="text-xs text-ink-soft">They didn&apos;t leave an email, so they&apos;ll see this next time they open the chat on your page.</p>}
        </ActionForm>
      </Card>
    </div>
  );
}
