import { describe, expect, it } from "vitest";
import { isPublicPath, safeRedirectPath } from "@/lib/routes";

describe("safeRedirectPath", () => {
  it("keeps same-site paths", () => {
    expect(safeRedirectPath("/")).toBe("/");
    expect(safeRedirectPath("/settings?tab=1")).toBe("/settings?tab=1");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, undefined, 42])(
    "rejects %s",
    (value) => {
      expect(safeRedirectPath(value)).toBe("/");
    },
  );
});

describe("isPublicPath", () => {
  it("only exposes login and auth callback routes", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/confirm")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/authorised")).toBe(false);
  });
});
