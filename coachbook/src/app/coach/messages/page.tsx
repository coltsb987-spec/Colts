import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getMyCoach } from "@/lib/auth";

export const metadata: Metadata = { title: "Messages" };

type Convo = {
  id: string; contact_name: string | null; needs_handoff: boolean; handoff_reason: string | null; last_message_at: string; coach_read_at: string | null;
  messages: { sender: string; content: string; created_at: string }[];
};

const ago = (iso: string, now: number) => {
  const mins = Math.round((now - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} hr ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export default async function MessagesPage() {
  const { coach, supabase } = await getMyCoach();
  if (!coach) redirect("/coach/profile");
  const { data } = await supabase
    .from("conversations")
    .select("id, contact_name, needs_handoff, handoff_reason, last_message_at, coach_read_at, messages(sender, content, created_at)")
    .eq("coach_id", coach.id)
    .order("last_message_at", { ascending: false })
    .order("created_at", { referencedTable: "messages", ascending: false })
    .limit(1, { referencedTable: "messages" })
    .limit(100)
    .returns<Convo[]>();
  const convos = (data ?? []).sort((a, b) => Number(b.needs_handoff) - Number(a.needs_handoff));
  const now = new Date().getTime();

  return (
    <>
      <PageHeader title="Messages" description="Chats with your AI receptionist. Ones that need you are at the top." />
      {convos.length === 0 ? (
        <Card className="bg-white/50">
          <p className="text-ink-soft">
            No conversations yet. Switch on your <Link href="/coach/receptionist" className="font-medium text-ink underline underline-offset-4">AI receptionist</Link> and share your booking link.
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {convos.map((c) => {
            const last = c.messages[0];
            const unread = !c.coach_read_at || Date.parse(c.coach_read_at) < Date.parse(c.last_message_at);
            return (
              <li key={c.id}>
                <Link href={`/coach/messages/${c.id}`} className="block">
                  <Card className="flex flex-col gap-1 p-4 transition-colors hover:border-ink/30 sm:p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className={`flex items-center gap-2 ${unread ? "font-semibold" : "font-medium"}`}>
                        {unread && <span aria-label="Unread" className="h-2 w-2 rounded-full bg-ink" />}
                        {c.contact_name ?? "Visitor"}
                        {c.needs_handoff && <Badge tone="accent">Needs you</Badge>}
                      </p>
                      <span className="text-xs text-ink-soft">{ago(c.last_message_at, now)}</span>
                    </div>
                    {c.needs_handoff && c.handoff_reason && <p className="text-sm">{c.handoff_reason}</p>}
                    {last && (
                      <p className="truncate text-sm text-ink-soft">
                        {last.sender === "customer" ? "" : last.sender === "ai" ? "Assistant: " : "You: "}
                        {last.content}
                      </p>
                    )}
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
