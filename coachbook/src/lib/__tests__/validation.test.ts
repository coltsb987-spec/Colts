import { describe, expect, it } from "vitest";
import {
  availabilityExceptionSchema,
  availabilityRuleSchema,
  coachProfileSchema,
  playerSchema,
  poundsToPence,
  safeNextPath,
  serviceSchema,
  slugify,
} from "../validation";
import { formatDuration, formatPrice } from "../format";

describe("slugify", () => {
  it("makes URL-friendly links", () => {
    expect(slugify("Jack's Football Academy")).toBe("jack-s-football-academy");
    expect(slugify("  Bolton & District  Skills ")).toBe("bolton-and-district-skills");
    expect(slugify("Élite Coaching!!")).toBe("elite-coaching");
  });
});

describe("poundsToPence", () => {
  it("parses prices", () => {
    expect(poundsToPence("35")).toBe(3500);
    expect(poundsToPence("£35.5")).toBe(3550);
    expect(poundsToPence("1,200.05")).toBe(120005);
    expect(poundsToPence("0")).toBe(0);
  });
  it("rejects bad input", () => {
    expect(poundsToPence("abc")).toBeNull();
    expect(poundsToPence("-5")).toBeNull();
    expect(poundsToPence("3.555")).toBeNull();
    expect(poundsToPence("")).toBeNull();
  });
});

describe("safeNextPath", () => {
  it("only allows local paths", () => {
    expect(safeNextPath("/coach/services")).toBe("/coach/services");
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("/\\evil.com")).toBe("/");
    expect(safeNextPath(null, "/parent")).toBe("/parent");
  });
});

describe("coachProfileSchema", () => {
  const base = {
    business_name: "Sam's Skills",
    slug: "sams-skills",
    bio: "",
    postcode: "M1 1AE",
    qualifications: "",
    dbs_checked: false,
    dbs_date: "",
    booking_notice_hours: "12",
  };
  it("accepts a valid profile and turns blanks into null", () => {
    const r = coachProfileSchema.parse(base);
    expect(r.bio).toBeNull();
    expect(r.postcode).toBe("M1 1AE");
  });
  it("rejects reserved and badly formatted links", () => {
    expect(coachProfileSchema.safeParse({ ...base, slug: "login" }).success).toBe(false);
    expect(coachProfileSchema.safeParse({ ...base, slug: "bad--slug" }).success).toBe(false);
    expect(coachProfileSchema.safeParse({ ...base, slug: "Has Space" }).success).toBe(false);
  });
  it("rejects a non-UK postcode", () => {
    expect(coachProfileSchema.safeParse({ ...base, postcode: "90210" }).success).toBe(false);
  });
  it("needs the DBS box ticked if a DBS date is given", () => {
    expect(coachProfileSchema.safeParse({ ...base, dbs_date: "2025-01-01" }).success).toBe(false);
    expect(coachProfileSchema.safeParse({ ...base, dbs_checked: true, dbs_date: "2025-01-01" }).success).toBe(true);
  });
});

describe("serviceSchema", () => {
  it("converts price and forces 1-to-1 to one participant", () => {
    const r = serviceSchema.parse({
      name: "1-to-1 session",
      description: "",
      type: "one_to_one",
      duration_minutes: "60",
      price: "35",
      max_participants: "6",
      location: "",
    });
    expect(r.price).toBe(3500);
    expect(r.max_participants).toBe(1);
  });
  it("rejects a bad price", () => {
    const r = serviceSchema.safeParse({
      name: "Group",
      description: "",
      type: "group",
      duration_minutes: "60",
      price: "lots",
      max_participants: "6",
      location: "",
    });
    expect(r.success).toBe(false);
  });
});

describe("availability", () => {
  it("rule end must be after start", () => {
    expect(availabilityRuleSchema.safeParse({ weekday: "1", start_time: "16:00", end_time: "19:00", location: "" }).success).toBe(true);
    expect(availabilityRuleSchema.safeParse({ weekday: "1", start_time: "19:00", end_time: "16:00", location: "" }).success).toBe(false);
  });
  it("blocked day can have no times; extra hours need times", () => {
    const blocked = { date: "2026-12-25", kind: "blocked", start_time: "", end_time: "", note: "Christmas" };
    expect(availabilityExceptionSchema.safeParse(blocked).success).toBe(true);
    expect(availabilityExceptionSchema.safeParse({ ...blocked, kind: "extra" }).success).toBe(false);
    expect(availabilityExceptionSchema.safeParse({ ...blocked, start_time: "10:00" }).success).toBe(false);
  });
});

describe("playerSchema", () => {
  it("requires parental consent", () => {
    expect(playerSchema.safeParse({ first_name: "Sam", age_group: "U10", notes: "", consent: false }).success).toBe(false);
    expect(playerSchema.safeParse({ first_name: "Sam", age_group: "U10", notes: "", consent: true }).success).toBe(true);
  });
});

describe("format", () => {
  it("formats prices and durations", () => {
    expect(formatPrice(3500)).toBe("£35");
    expect(formatPrice(3550)).toBe("£35.50");
    expect(formatPrice(0)).toBe("Free");
    expect(formatDuration(90)).toBe("1 hr 30 min");
    expect(formatDuration(45)).toBe("45 min");
  });
});

import { postcodeArea } from "../format";
describe("postcodeArea", () => {
  it("shows only the outward code", () => {
    expect(postcodeArea("M1 1AE")).toBe("M1");
    expect(postcodeArea("sw1a1aa")).toBe("SW1A");
    expect(postcodeArea(null)).toBeNull();
  });
});

import { readSettings } from "../receptionist/settings";
describe("receptionist settings", () => {
  it("fills defaults from the Phase 1 shape", () => {
    const s = readSettings({ tone: "friendly", faqs: [], rules: {} });
    expect(s).toMatchObject({ enabled: false, tone: "friendly", cancellation_notice_hours: 24, faqs: [] });
  });
  it("keeps valid parts of bad data", () => {
    const s = readSettings({ enabled: true, tone: "rude", faqs: "nope" });
    expect(s.enabled).toBe(true);
    expect(s.tone).toBe("friendly");
    expect(s.faqs).toEqual([]);
  });
});
