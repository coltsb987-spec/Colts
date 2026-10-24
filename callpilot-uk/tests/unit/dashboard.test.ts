import { describe, expect, it } from "vitest";
import { formatDuration, mapBusiness, mapStats } from "@/lib/dashboard";

describe("dashboard mapping", () => {
  it("maps a business row with an embedded call count", () => {
    expect(
      mapBusiness({ id: "b1", name: "Acme", business_type: "Other", status: "setup_needed", phone_number: null, calls: [{ count: 3 }] }),
    ).toEqual({ id: "b1", name: "Acme", businessType: "Other", status: "setup_needed", phoneNumber: null, callCount: 3 });
  });

  it("defaults missing call counts and stats to zero", () => {
    expect(mapBusiness({ id: "b", name: "A", business_type: "x", status: "active", phone_number: null, calls: null }).callCount).toBe(0);
    expect(mapStats(null)).toEqual({ totalCalls: 0, leadsCaptured: 0, bookingRequests: 0, avgDurationSeconds: 0 });
  });

  it("converts bigint strings from Postgres", () => {
    expect(mapStats({ total_calls: "5", leads_captured: "2", booking_requests: "1", avg_duration_seconds: 92 }).totalCalls).toBe(5);
  });

  it("formats durations", () => {
    expect(formatDuration(92)).toBe("1m 32s");
    expect(formatDuration(5)).toBe("0m 05s");
    expect(formatDuration(-3)).toBe("0m 00s");
  });
});
