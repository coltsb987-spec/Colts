import { z } from "zod";

// What a coach can configure for their AI receptionist (stored in coaches.receptionist_settings).
export const TONES = {
  friendly: "Friendly and warm",
  professional: "Professional and concise",
  energetic: "Upbeat and energetic",
} as const;

export const faqSchema = z.object({
  q: z.string().trim().min(3, "Each question needs a few words").max(200),
  a: z.string().trim().min(1, "Each question needs an answer").max(1000),
});

export const receptionistSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  tone: z.enum(["friendly", "professional", "energetic"]).default("friendly"),
  greeting: z.string().trim().max(300).default(""),
  faqs: z.array(faqSchema).max(30, "Up to 30 questions").default([]),
  // Parents (via the receptionist) may cancel or move a booking only this long before it starts.
  cancellation_notice_hours: z.coerce.number().int().min(0).max(168).default(24),
  extra_instructions: z.string().trim().max(1000).default(""),
});

export type ReceptionistSettings = z.infer<typeof receptionistSettingsSchema>;

/** Reads stored settings, filling in defaults for anything missing or invalid. */
export function readSettings(raw: unknown): ReceptionistSettings {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const parsed = receptionistSettingsSchema.safeParse(obj);
  if (parsed.success) return parsed.data;
  // Keep what's valid, drop what isn't (e.g. an old shape).
  const fallback = receptionistSettingsSchema.parse({});
  for (const key of Object.keys(fallback) as (keyof ReceptionistSettings)[]) {
    const one = receptionistSettingsSchema.shape[key].safeParse(obj[key]);
    if (one.success) (fallback as Record<string, unknown>)[key] = one.data;
  }
  return fallback;
}

export function defaultGreeting(businessName: string) {
  return `Hi! I'm the AI assistant for ${businessName}. I can tell you about sessions, check free times and help you book. What can I help with?`;
}
