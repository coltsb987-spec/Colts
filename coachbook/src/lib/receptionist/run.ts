import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BookingCoach } from "@/lib/bookings";
import { createAdminClient } from "@/lib/supabase/admin";
import { dynamicSystemPrompt, stableSystemPrompt, type PromptCoach } from "./prompt";
import type { ReceptionistSettings } from "./settings";
import { receptionistTools, type ReceptionistAction, type ToolContext } from "./tools";

// The default model for the receptionist; override with RECEPTIONIST_MODEL (e.g. claude-sonnet-5-5).
export const RECEPTIONIST_MODEL = process.env.RECEPTIONIST_MODEL || "claude-opus-5-5";
const HISTORY_LIMIT = 40;

let client: Anthropic | null = null;
function anthropic() {
  client ??= new Anthropic({ maxRetries: 2, timeout: 45_000 });
  return client;
}

export function isReceptionistConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type ReceptionistReply = { reply: string; actions: ReceptionistAction[]; handedOff: boolean };

/**
 * Runs one turn: the visitor's message (already saved) + history -> Claude with tools -> reply.
 * History is rebuilt from saved text each turn (thinking from earlier turns isn't replayed).
 */
export async function runReceptionistTurn(opts: {
  coach: BookingCoach & PromptCoach;
  settings: ReceptionistSettings;
  conversationId: string;
  parent: ToolContext["parent"];
}): Promise<ReceptionistReply> {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("messages")
    .select("sender, content")
    .eq("conversation_id", opts.conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const history = (rows ?? []).reverse();
  // The first message sent to Claude must come from the visitor.
  while (history.length && history[0].sender !== "customer") history.shift();

  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) =>
    m.sender === "customer"
      ? { role: "user", content: m.content }
      : { role: "assistant", content: m.sender === "coach" ? `[Message from ${opts.coach.business_name} (the coach), sent in this chat:] ${m.content}` : m.content },
  );

  const ctx: ToolContext = {
    coach: opts.coach,
    settings: opts.settings,
    conversationId: opts.conversationId,
    parent: opts.parent,
    actions: [],
    handedOff: false,
  };

  let final: Anthropic.Beta.BetaMessage;
  try {
    final = await anthropic().beta.messages.toolRunner({
      model: RECEPTIONIST_MODEL,
      max_tokens: 8000,
      // A chat assistant: low effort keeps replies quick and cheap.
      output_config: { effort: "low" },
      // If the model declines a request on safety grounds, Anthropic retries it on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        // Stable per coach -> cached across turns and visitors.
        { type: "text", text: stableSystemPrompt(opts.coach, opts.settings), cache_control: { type: "ephemeral" } },
        { type: "text", text: dynamicSystemPrompt({ now: new Date(), parentSignedIn: Boolean(opts.parent), parentName: opts.parent?.name }) },
      ],
      tools: receptionistTools(ctx),
      messages,
      max_iterations: 8,
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      console.error("receptionist rate limited", e.message);
      return { reply: "Sorry, I'm very busy right now. Please try again in a minute.", actions: [], handedOff: false };
    }
    if (e instanceof Anthropic.APIError) {
      console.error("receptionist API error", e.status, e.message);
    } else {
      console.error("receptionist failed", e);
    }
    return { reply: "Sorry, something went wrong on my side. Please try again, or contact the coach directly.", actions: ctx.actions, handedOff: ctx.handedOff };
  }

  if (final.stop_reason === "refusal") {
    return { reply: "Sorry, I can't help with that here. I can tell you about sessions, check free times, or pass a message to the coach.", actions: [], handedOff: ctx.handedOff };
  }

  const text = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return {
    reply: text || (ctx.actions.length ? "Here you go:" : "Sorry, I didn't catch that. Could you say it another way?"),
    actions: ctx.actions,
    handedOff: ctx.handedOff,
  };
}
