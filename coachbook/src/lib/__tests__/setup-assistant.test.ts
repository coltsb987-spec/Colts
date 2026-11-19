import { describe, expect, it } from "vitest";
import { htmlToText, isPrivateAddress, looksBlocked } from "../setup-assistant/page-text";
import { postcodeArea } from "../format";
import { coachProfileSchema } from "../validation";

describe("reading web pages", () => {
  it("turns HTML into text with title and description, dropping scripts", () => {
    const p = htmlToText(`<html><head><title>Sam&#39;s Coaching</title><meta property="og:description" content="1-to-1s &pound;30"><script>evil()</script></head>
      <body><h1>Sessions</h1><p>Saturdays 9&ndash;12</p><style>p{}</style></body></html>`);
    expect(p.title).toBe("Sam's Coaching");
    expect(p.description).toBe("1-to-1s £30");
    expect(p.text).toContain("Saturdays 9–12");
    expect(p.text).not.toContain("evil");
  });
  it("spots Instagram and Facebook login walls in plain words", () => {
    const wall = { title: "Login • Instagram", description: "", text: "Log in Sign up" };
    expect(looksBlocked(new URL("https://www.instagram.com/accounts/login/?next=/sam"), wall)).toMatch(/Instagram didn't let us read/);
    expect(looksBlocked(new URL("https://www.facebook.com/sam"), { title: "Facebook", description: "", text: "Log in" })).toMatch(/Facebook/);
    expect(looksBlocked(new URL("https://example.com/"), { title: "", description: "", text: "Hi" })).toMatch(/enough text/);
    expect(looksBlocked(new URL("https://example.com/"), { title: "Coach", description: "", text: "x".repeat(200) })).toBeNull();
  });
  it("refuses private and internal addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["76.76.21.21", "8.8.8.8", "2606:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("postcode areas", () => {
  it("accepts a full postcode or just the area", () => {
    const base = { business_name: "Sam", slug: "sam-coaching", bio: "", qualifications: "", dbs_checked: false, dbs_date: "", booking_notice_hours: 12 };
    expect(coachProfileSchema.safeParse({ ...base, postcode: "BL1" }).success).toBe(true);
    expect(coachProfileSchema.safeParse({ ...base, postcode: "SW1A 1AA" }).success).toBe(true);
    expect(coachProfileSchema.safeParse({ ...base, postcode: "Bolton" }).success).toBe(false);
  });
  it("shows only the area publicly", () => {
    expect(postcodeArea("M14 6HR")).toBe("M14");
    expect(postcodeArea("SW1A1AA")).toBe("SW1A");
    expect(postcodeArea("SW1A")).toBe("SW1A");
    expect(postcodeArea("BL1")).toBe("BL1");
  });
});
