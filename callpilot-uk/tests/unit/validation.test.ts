import { describe, expect, it } from "vitest";
import { businessSchema, firstErrors, signInSchema, signUpSchema } from "@/lib/validation";

const WS = "3f1c2a4e-8b7d-4c6a-9e2f-1a2b3c4d5e6f";

describe("businessSchema", () => {
  it("accepts and trims a valid business", () => {
    const r = businessSchema.parse({ workspaceId: WS, name: "  Smith & Sons  ", businessType: "Cleaning" });
    expect(r.name).toBe("Smith & Sons");
  });

  it("rejects short, long and missing names", () => {
    for (const name of ["", " a ", "x".repeat(101), null]) {
      const r = businessSchema.safeParse({ workspaceId: WS, name, businessType: "Other" });
      expect(r.success).toBe(false);
      if (!r.success) expect(firstErrors(r.error).name).toBeTruthy();
    }
  });

  it("rejects unknown business types and bad workspace ids", () => {
    const r = businessSchema.safeParse({ workspaceId: "not-a-uuid", name: "Valid name", businessType: "Casino" });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(firstErrors(r.error)).sort()).toEqual(["businessType", "workspaceId"]);
  });
});

describe("auth schemas", () => {
  it("normalises email", () => {
    expect(signInSchema.parse({ email: " Owner@Example.COM ", password: "x" }).email).toBe("owner@example.com");
  });

  it("rejects invalid email", () => {
    expect(signInSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
  });

  it("requires a 10-72 character password on sign up", () => {
    expect(signUpSchema.safeParse({ email: "a@b.co", password: "short" }).success).toBe(false);
    expect(signUpSchema.safeParse({ email: "a@b.co", password: "x".repeat(73) }).success).toBe(false);
    expect(signUpSchema.safeParse({ email: "a@b.co", password: "correct horse" }).success).toBe(true);
  });
});
