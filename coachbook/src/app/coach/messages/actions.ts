"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getMyCoach } from "@/lib/auth";
import { emailLayout, sendEmail } from "@/lib/email";
import { siteUrl } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "@/lib/types";

async function ownConversation(id: string) {
  const { coach, supabase, user } = await getMyCoach();
  if (!coach) redirect("/coach/profile");
  // RLS: coaches can only read their own conversations.
  const { data } = await supabase.from("conversations").select("id, contact_email, contact_name").eq("id", id).eq("coach_id", coach.id).maybeSingle();
  return { coach, supabase, user, convo: data };
}

export async function replyToConversation(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { coach, supabase, user, convo } = await ownConversation(id);
  if (!convo) return { error: "Conversation not found." };
  const parsed = z.string().trim().min(1, "Type a reply").max(2000).safeParse(formData.get("reply"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { error } = await supabase.from("messages").insert({ conversation_id: id, sender: "coach", content: parsed.data });
  if (error) return { error: "Couldn't send. Please try again." };
  await createAdminClient()
    .from("conversations")
    .update({ last_message_at: new Date().toISOString(), coach_read_at: new Date().toISOString(), needs_handoff: false })
    .eq("id", id);

  let emailed = false;
  if (convo.contact_email) {
    const r = await sendEmail({
      to: convo.contact_email,
      replyTo: user.email ?? null,
      subject: `${coach.business_name} replied to your message`,
      ...emailLayout({
        heading: `${coach.business_name} replied`,
        lines: [parsed.data, "You can reply to this email, or carry on the chat on the booking page."],
        cta: { label: "Open booking page", url: `${siteUrl()}/${coach.slug}` },
      }),
    });
    emailed = !r.skipped && r.ok !== false;
  }
  revalidatePath(`/coach/messages/${id}`);
  revalidatePath("/coach/messages");
  return { success: emailed ? "Sent – they'll see it in the chat and by email." : "Sent – they'll see it next time they open the chat." };
}

export async function setHandled(id: string, handled: boolean, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const { supabase, convo } = await ownConversation(id);
  if (!convo) return { error: "Conversation not found." };
  await supabase.from("conversations").update({ needs_handoff: !handled }).eq("id", id);
  revalidatePath(`/coach/messages/${id}`);
  revalidatePath("/coach/messages");
  return { success: handled ? "Marked as handled." : "Flagged." };
}
