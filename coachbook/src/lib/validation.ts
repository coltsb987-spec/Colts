import { z } from "zod";

export const RESERVED_SLUGS = new Set([
  "admin", "api", "auth", "coach", "coaches", "parent", "parents", "login", "logout", "signup",
  "sign-in", "sign-up", "dashboard", "settings", "about", "pricing", "privacy", "terms", "help",
  "support", "book", "booking", "bookings", "_next", "static",
]);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

/** Converts "35", "35.5", "£35.50" to pence. Returns null if invalid. */
export function poundsToPence(input: string): number | null {
  const cleaned = input.trim().replace(/^£/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Only allow redirects to paths on this site (blocks "//evil.com" and "https://..."). */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

// UK postcode: a full postcode ("M14 6HR") or just the area part ("M14").
export const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?$/i;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((v) => (v === "" ? null : v));

const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time like 16:00");

export const coachProfileSchema = z
  .object({
    business_name: z.string().trim().min(2, "Business name is too short").max(100),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, "Your link must be at least 3 characters")
      .max(50)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single dashes only")
      .refine((s) => !RESERVED_SLUGS.has(s), "That link is reserved – please choose another"),
    bio: optionalText(2000),
    postcode: optionalText(10).refine((v) => v === null || UK_POSTCODE.test(v), "Enter a UK postcode, or just its first part (e.g. M14)"),
    qualifications: optionalText(1000),
    dbs_checked: z.boolean(),
    booking_notice_hours: z.coerce.number().int().min(0).max(168),
    dbs_date: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date"),
  })
  .refine((d) => !d.dbs_date || d.dbs_checked, { message: "Tick the DBS box if you add a DBS date", path: ["dbs_date"] });

export const serviceSchema = z
  .object({
    name: z.string().trim().min(2, "Name is too short").max(100),
    description: optionalText(1000),
    type: z.enum(["one_to_one", "group", "camp"]),
    duration_minutes: z.coerce.number().int().min(15, "At least 15 minutes").max(720, "At most 12 hours"),
    price: z.string().transform((v, ctx) => {
      const pence = poundsToPence(v);
      if (pence === null) {
        ctx.addIssue({ code: "custom", message: "Enter a price like 35 or 35.50" });
        return z.NEVER;
      }
      if (pence > 1_000_000) {
        ctx.addIssue({ code: "custom", message: "Price is too high" });
        return z.NEVER;
      }
      return pence;
    }),
    max_participants: z.coerce.number().int().min(1).max(200),
    location: optionalText(200),
  })
  .transform((d) => ({ ...d, max_participants: d.type === "one_to_one" ? 1 : d.max_participants }));

export const availabilityRuleSchema = z
  .object({
    weekday: z.coerce.number().int().min(0).max(6),
    start_time: timeString,
    end_time: timeString,
    location: optionalText(200),
  })
  .refine((d) => d.end_time > d.start_time, { message: "End time must be after start time", path: ["end_time"] });

export const availabilityExceptionSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
    kind: z.enum(["blocked", "extra"]),
    start_time: z.union([timeString, z.literal("")]).transform((v) => v || null),
    end_time: z.union([timeString, z.literal("")]).transform((v) => v || null),
    note: optionalText(200),
  })
  .refine((d) => (d.start_time === null) === (d.end_time === null), {
    message: "Enter both a start and end time, or leave both empty to block the whole day",
    path: ["end_time"],
  })
  .refine((d) => d.start_time === null || d.end_time! > d.start_time, {
    message: "End time must be after start time",
    path: ["end_time"],
  })
  .refine((d) => d.kind === "blocked" || d.start_time !== null, {
    message: "Extra hours need a start and end time",
    path: ["start_time"],
  });

export const playerSchema = z.object({
  first_name: z.string().trim().min(1, "Enter a first name").max(50),
  age_group: z.string().trim().min(1, "Choose an age group").max(20),
  notes: optionalText(500),
  consent: z.literal(true, { error: "Please confirm you are the parent or guardian and give consent" }),
});

export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form";
}
