import { describe, expect, it } from "vitest";
import { passwordProblem } from "../password";

describe("passwordProblem", () => {
  it("accepts long, unusual passwords", () => {
    expect(passwordProblem("kettle-goalpost-orbit", "sam@example.com")).toBeNull();
    expect(passwordProblem("Blue7Fox!Moss", "sam@example.com")).toBeNull();
  });
  it("rejects short, common, repeated or email-based passwords", () => {
    expect(passwordProblem("short1!")).toMatch(/at least 10/);
    expect(passwordProblem("Password123")).toMatch(/too common/);
    expect(passwordProblem("Football123!")).toMatch(/too common/);
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/too easy|too common/);
    expect(passwordProblem("1234567890abc")).toMatch(/too easy/);
    expect(passwordProblem("samjones-2026!", "sam.jones@example.com")).toMatch(/email/);
    expect(passwordProblem("x".repeat(73))).toMatch(/72/);
  });
});
