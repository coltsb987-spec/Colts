import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { loadCoachBySlug } from "@/lib/bookings";
import { readSettings } from "@/lib/receptionist/settings";
import { isReceptionistConfigured, runReceptionistTurn } from "@/lib/receptionist/run";
import { createAdminClient } from "@/lib/supabase/admin";

// The AI can take a few tool calls to answer; allow up to a minute.
export const maxDuration = 60;

// Spending guards (can be tuned with environment variables).
const LIMITS = {
  messagesPerConversation: Number(process.env.RECEPTIONIST_MAX_MESSAGES_PER_CHAT ?? 30),
  newChatsPerIpPerHour: Number(process.env.RECEPTIONIST_MAX_CHATS_PER_IP_HOUR ?? 10),
  messagesPerCoachPerDay: Number(process.env.RECEPTIONIST_MAX_MESSAGES_PER_COACH_DAY ?? 300),
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const tokenMatches = (token: string, hash: string | null) => {
  if (!hash) return false;
  const a = Buffer.from(sha(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
};
function ipHash(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  // Salted so the stored value can't be turned back into an IP address.
  return sha(`${process.env.SUPABASE_SECRET_KEY ?? ""}:${ip}`).slice(0, 32);
}

async function loadReceptionistCoach(slug: string) {
  if (!/^[a-z0-9-]{3,50}$/.test(slug)) return null;
  const coach = await loadCoachBySlug(slug);
  if (!coach?.published) return null;
  const settings = readSettings(coach.receptionist_settings);
  if (!settings.enabled) return null;
  return { coach, settings };
}

async function loadConversation(coachId: string, id: string, token: string) {
  const { data } = await createAdminClient()
    .from("conversations")
    .select("id, coach_id, visitor_token_hash")
    .eq("id", id)
    .eq("coach_id", coachId)
    .maybeSingle();
  return data && tokenMatches(token, data.visitor_token_hash) ? data : null;
}

async function visibleMessages(conversationId: string) {
  const { data } = await createAdminClient()
    .from("messages")
    .select("id, sender, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at")
    .limit(200);
  return data ?? [];
}

const postSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  conversation_id: z.string().regex(/^[0-9a-f-]{36}$/).optional(),
  token: z.string().min(20).max(100).optional(),
});

/** Send a message to the receptionist. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!isReceptionistConfigured()) return NextResponse.json({ error: "The assistant isn't available right now." }, { status: 503 });
  const found = await loadReceptionistCoach((await params).slug);
  if (!found) return NextResponse.json({ error: "The assistant isn't available for this coach." }, { status: 404 });
  const { coach, settings } = found;

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please type a message (up to 1000 characters)." }, { status: 400 });
  const { message } = parsed.data;
  const admin = createAdminClient();

  // Is the visitor signed in as a parent? (from their own session cookie)
  const { user, profile } = await getCurrentProfile();
  const parent = user && profile?.role === "parent" ? { id: user.id, email: user.email, name: profile.full_name } : null;

  // Daily cap per coach.
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count: coachToday } = await admin
    .from("messages")
    .select("id, conversations!inner(coach_id)", { count: "exact", head: true })
    .eq("conversations.coach_id", coach.id)
    .eq("sender", "customer")
    .gte("created_at", dayAgo);
  if ((coachToday ?? 0) >= LIMITS.messagesPerCoachPerDay)
    return NextResponse.json({ error: "The assistant is taking a break. Please try again later or contact the coach directly." }, { status: 429 });

  // Existing conversation (proved by its token) or a new one.
  let conversationId: string;
  let newToken: string | undefined;
  if (parsed.data.conversation_id && parsed.data.token) {
    const convo = await loadConversation(coach.id, parsed.data.conversation_id, parsed.data.token);
    if (!convo) return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
    conversationId = convo.id;
    const { count } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId).eq("sender", "customer");
    if ((count ?? 0) >= LIMITS.messagesPerConversation)
      return NextResponse.json({ error: "This chat has reached its limit. Please start a new chat or contact the coach directly." }, { status: 429 });
  } else {
    const ip = ipHash(req);
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from("conversations").select("id", { count: "exact", head: true }).eq("ip_hash", ip).gte("created_at", hourAgo);
    if ((count ?? 0) >= LIMITS.newChatsPerIpPerHour) return NextResponse.json({ error: "Too many new chats. Please try again later." }, { status: 429 });
    newToken = randomBytes(24).toString("base64url");
    const { data, error } = await admin
      .from("conversations")
      .insert({ coach_id: coach.id, channel: "web", visitor_token_hash: sha(newToken), ip_hash: ip, parent_profile_id: parent?.id ?? null, contact_name: parent?.name ?? null, contact_email: parent?.email ?? null })
      .select("id")
      .single();
    if (error || !data) return NextResponse.json({ error: "Couldn't start the chat." }, { status: 500 });
    conversationId = data.id;
  }

  await admin.from("messages").insert({ conversation_id: conversationId, sender: "customer", content: message });
  if (parent) await admin.from("conversations").update({ parent_profile_id: parent.id }).eq("id", conversationId).is("parent_profile_id", null);

  // Coach details used in the prompt.
  const { data: profileRow } = await admin.from("coaches").select("bio, qualifications, postcode, dbs_checked, dbs_date").eq("id", coach.id).single();
  const result = await runReceptionistTurn({ coach: { ...coach, ...profileRow! }, settings, conversationId, parent });

  await admin.from("messages").insert({ conversation_id: conversationId, sender: "ai", content: result.reply });
  await admin.from("conversations").update({ last_message_at: new Date().toISOString(), coach_read_at: null }).eq("id", conversationId);

  return NextResponse.json({
    conversation_id: conversationId,
    ...(newToken ? { token: newToken } : {}),
    reply: result.reply,
    actions: result.actions,
    handed_off: result.handedOff,
    // Token usage is shown only to the owner's own test tools (same secret as the reminder job).
    ...(process.env.CRON_SECRET && req.headers.get("x-usage-key") === process.env.CRON_SECRET ? { usage: result.usage } : {}),
    messages: await visibleMessages(conversationId),
  });
}

/** Reload a conversation (e.g. to see the coach's replies). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const found = await loadReceptionistCoach((await params).slug);
  if (!found) return NextResponse.json({ error: "not_available" }, { status: 404 });
  const id = req.nextUrl.searchParams.get("conversation_id") ?? "";
  const token = req.headers.get("x-chat-token") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id) || !token) return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
  const convo = await loadConversation(found.coach.id, id, token);
  if (!convo) return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
  return NextResponse.json({ conversation_id: id, messages: await visibleMessages(id) });
}
