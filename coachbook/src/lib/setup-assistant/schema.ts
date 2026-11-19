import { z } from "zod";

// The draft Claude returns. Kept to plain types (structured outputs); everything is
// validated again with the app's normal form rules before anything is saved.
export const profileDraftSchema = z.object({
  business_name: z.string().nullable().describe("The coaching business name, exactly as the coach uses it. null if not given."),
  bio: z.string().nullable().describe("2-5 sentence bio in the coach's own voice (first person), using only facts provided. null if too little to go on."),
  qualifications: z.string().nullable().describe("Qualifications exactly as stated, one per line. null if none stated."),
  postcode_area: z.string().nullable().describe("UK postcode, or just its first part (e.g. 'BL1' or 'M14'), if given. null if only a town is known."),
  town: z.string().nullable().describe("Town or area they coach in (e.g. 'Bolton'), if given."),
  dbs_mentioned: z.boolean().describe("True if the sources say the coach holds a DBS check."),
  services: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(["one_to_one", "group", "camp"]),
        duration_minutes: z.number().int().describe("Session length in minutes. Use 60 only if the sources say an hour."),
        price_pounds: z.number().nullable().describe("Price in pounds (per player for groups/camps). null if not stated."),
        max_participants: z.number().int().nullable().describe("Maximum players for groups/camps. null if not stated or 1-to-1."),
        location: z.string().nullable(),
        description: z.string().nullable(),
      }),
    )
    .describe("Bookable session types the coach offers."),
  weekly_hours: z
    .array(
      z.object({
        weekday: z.number().int().describe("0=Sunday, 1=Monday ... 6=Saturday"),
        start: z.string().describe("HH:MM, 24-hour"),
        end: z.string().describe("HH:MM, 24-hour"),
        location: z.string().nullable(),
      }),
    )
    .describe("Usual weekly coaching hours, only if the sources give them."),
  faqs: z
    .array(z.object({ q: z.string(), a: z.string() }))
    .describe("Questions parents commonly ask, answered only from facts in the sources (kit, weather, ages, parking, refunds...)."),
  questions: z
    .array(z.object({ id: z.string(), question: z.string() }))
    .describe("Up to 5 short questions about essential missing details (e.g. prices, hours, session length). Empty if nothing essential is missing."),
  notes: z.array(z.string()).describe("Short notes for the coach: links that couldn't be read, things left out, assumptions to check."),
});

export type ProfileDraft = z.infer<typeof profileDraftSchema>;

export const MAX_SOURCE_CHARS = 8000;
export const MAX_LINKS = 3;
export const MAX_IMAGES = 5;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
