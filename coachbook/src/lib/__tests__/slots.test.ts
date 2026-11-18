import { describe, expect, it } from "vitest";
import { computeSlots, groupSlotKey, londonDate, londonToUtc, windowsForDate, type ExistingBooking } from "../slots";
import type { AvailabilityException, AvailabilityRule } from "../types";

const rule = (weekday: number, start: string, end: string): AvailabilityRule => ({
  id: `${weekday}${start}`, coach_id: "c", weekday, start_time: `${start}:00`, end_time: `${end}:00`, location: null,
});
const oneToOne = { id: "svc1", type: "one_to_one" as const, duration_minutes: 60, max_participants: 1 };
const group = { id: "grp1", type: "group" as const, duration_minutes: 60, max_participants: 2 };
// Monday 7 Dec 2026, 09:00 UTC (= 09:00 London, winter)
const now = new Date("2026-12-07T09:00:00Z");

describe("London time", () => {
  it("handles winter (GMT) and summer (BST)", () => {
    expect(londonToUtc("2026-12-07", 16 * 60).toISOString()).toBe("2026-12-07T16:00:00.000Z");
    expect(londonToUtc("2026-07-06", 16 * 60).toISOString()).toBe("2026-07-06T15:00:00.000Z");
  });
  it("handles the clock-change days", () => {
    // 29 Mar 2026: clocks go forward at 01:00 UTC
    expect(londonToUtc("2026-03-29", 10 * 60).toISOString()).toBe("2026-03-29T09:00:00.000Z");
    // 25 Oct 2026: clocks go back at 01:00 UTC
    expect(londonToUtc("2026-10-25", 10 * 60).toISOString()).toBe("2026-10-25T10:00:00.000Z");
  });
  it("gives London dates", () => {
    expect(londonDate(new Date("2026-07-06T23:30:00Z"))).toBe("2026-07-07");
  });
  it("group slot key matches the database format", () => {
    expect(groupSlotKey("abc", new Date("2026-12-08T16:00:00.000Z"))).toBe("abc@2026-12-08T16:00:00Z");
  });
});

describe("windowsForDate", () => {
  const rules = [rule(1, "16:00", "19:00")];
  it("blocks a whole day", () => {
    const exc: AvailabilityException[] = [{ id: "x", coach_id: "c", date: "2026-12-07", kind: "blocked", start_time: null, end_time: null, location: null, note: null }];
    expect(windowsForDate("2026-12-07", rules, exc)).toEqual([]);
  });
  it("blocks part of a day and adds extra hours", () => {
    const exc: AvailabilityException[] = [
      { id: "x", coach_id: "c", date: "2026-12-07", kind: "blocked", start_time: "17:00:00", end_time: "18:00:00", location: null, note: null },
      { id: "y", coach_id: "c", date: "2026-12-07", kind: "extra", start_time: "10:00:00", end_time: "12:00:00", location: null, note: null },
    ];
    expect(windowsForDate("2026-12-07", rules, exc).map((w) => [w.start / 60, w.end / 60])).toEqual([[10, 12], [16, 17], [18, 19]]);
  });
});

describe("computeSlots", () => {
  const base = { rules: [rule(1, "16:00", "19:00")], exceptions: [], now, days: 7, noticeHours: 2 };

  it("offers 1-to-1 starts every 30 minutes that fit", () => {
    const days = computeSlots({ ...base, service: oneToOne, bookings: [] });
    expect(days[0].date).toBe("2026-12-07");
    expect(days[0].slots.map((s) => s.start.slice(11, 16))).toEqual(["16:00", "16:30", "17:00", "17:30", "18:00"]);
  });

  it("respects booking notice", () => {
    const days = computeSlots({ ...base, service: oneToOne, bookings: [], noticeHours: 8 }); // earliest 17:00
    expect(days[0].slots[0].start.slice(11, 16)).toBe("17:00");
  });

  it("removes slots that overlap a booking, but ignores expired holds", () => {
    const booked: ExistingBooking = { id: "b1", start_at: "2026-12-07T17:00:00Z", end_at: "2026-12-07T18:00:00Z", slot_key: "u1", status: "confirmed", hold_expires_at: null };
    const expired: ExistingBooking = { id: "b2", start_at: "2026-12-07T16:00:00Z", end_at: "2026-12-07T17:00:00Z", slot_key: "u2", status: "pending", hold_expires_at: "2026-12-07T08:00:00Z" };
    const days = computeSlots({ ...base, service: oneToOne, bookings: [booked, expired] });
    expect(days[0].slots.map((s) => s.start.slice(11, 16))).toEqual(["16:00", "18:00"]);
  });

  it("can ignore the booking being rescheduled", () => {
    const booked: ExistingBooking = { id: "b1", start_at: "2026-12-07T17:00:00Z", end_at: "2026-12-07T18:00:00Z", slot_key: "u1", status: "confirmed", hold_expires_at: null };
    const days = computeSlots({ ...base, service: oneToOne, bookings: [booked], excludeBookingId: "b1" });
    expect(days[0].slots).toHaveLength(5);
  });

  it("fills group sessions up to capacity", () => {
    const start = new Date("2026-12-07T16:00:00Z");
    const player = (id: string): ExistingBooking => ({ id, start_at: start.toISOString(), end_at: "2026-12-07T17:00:00Z", slot_key: groupSlotKey("grp1", start), status: "confirmed", hold_expires_at: null });
    let days = computeSlots({ ...base, service: group, bookings: [player("p1")] });
    expect(days[0].slots.map((s) => [s.start.slice(11, 16), s.spotsLeft])).toEqual([["16:00", 1], ["17:00", 2], ["18:00", 2]]);
    days = computeSlots({ ...base, service: group, bookings: [player("p1"), player("p2")] });
    expect(days[0].slots.map((s) => s.start.slice(11, 16))).toEqual(["17:00", "18:00"]);
  });

  it("a group session can't overlap a 1-to-1", () => {
    const b: ExistingBooking = { id: "b1", start_at: "2026-12-07T17:30:00Z", end_at: "2026-12-07T18:30:00Z", slot_key: "u1", status: "confirmed", hold_expires_at: null };
    const days = computeSlots({ ...base, service: group, bookings: [b] });
    expect(days[0].slots.map((s) => s.start.slice(11, 16))).toEqual(["16:00"]);
  });
});

import { summariseEarnings } from "../earnings";
describe("summariseEarnings", () => {
  it("counts paid sessions by London month, net of platform fee", () => {
    const now = new Date("2026-12-10T12:00:00Z");
    const r = (start_at: string, price: number, extra: Partial<{ status: string; payment_status: string; fee: number }> = {}) => ({
      start_at, price_pence: price, platform_fee_pence: extra.fee ?? 0, status: extra.status ?? "confirmed", payment_status: extra.payment_status ?? "paid",
    });
    const s = summariseEarnings([
      r("2026-12-01T10:00:00Z", 3500, { fee: 175 }),
      r("2026-12-20T10:00:00Z", 3500),
      r("2026-11-30T23:30:00Z", 1000), // still November in London (GMT)
      r("2026-12-05T10:00:00Z", 3500, { status: "cancelled", payment_status: "refunded" }),
      r("2026-12-06T10:00:00Z", 3500, { status: "pending", payment_status: "unpaid" }),
    ], now);
    expect(s).toEqual({ thisMonth: 6825, lastMonth: 1000, upcoming: 3500, allTime: 7825 });
  });
});
