// Slot engine: turns a coach's weekly hours, one-off changes and existing bookings
// into bookable start times. Pure functions (no database), so it is easy to test.
// All coach times are UK local time (Europe/London); results are UTC instants.

import type { AvailabilityException, AvailabilityRule, ServiceType } from "./types";

export const TIME_ZONE = "Europe/London";

export type SlotService = {
  id: string;
  type: ServiceType;
  duration_minutes: number;
  max_participants: number;
};

export type ExistingBooking = {
  id: string;
  start_at: string;
  end_at: string;
  slot_key: string;
  status: string;
  hold_expires_at: string | null;
};

export type Slot = { start: string; end: string; spotsLeft: number; location: string | null };
export type DaySlots = { date: string; slots: Slot[] };

const MS_MIN = 60_000;

/** Offset of Europe/London from UTC at a given instant, in minutes (0 or 60). */
function londonOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(at.getTime() / MS_MIN) * MS_MIN) / MS_MIN);
}

/** "2026-03-29" + 600 (minutes after midnight, London) -> UTC Date */
export function londonToUtc(date: string, minutesAfterMidnight: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutesAfterMidnight);
  let result = naive - londonOffsetMinutes(new Date(naive)) * MS_MIN;
  // Re-check once in case the guess crossed a clock change.
  result = naive - londonOffsetMinutes(new Date(result)) * MS_MIN;
  return new Date(result);
}

/** UTC instant -> London calendar date "YYYY-MM-DD" */
export function londonDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Must match public.slot_key_for() in the database. */
export function groupSlotKey(serviceId: string, start: Date): string {
  return `${serviceId}@${start.toISOString().replace(/\.\d{3}Z$/, "Z")}`;
}

type Window = { start: number; end: number; location: string | null };

function subtract(windows: Window[], start: number, end: number): Window[] {
  return windows.flatMap((w) => {
    if (end <= w.start || start >= w.end) return [w];
    const out: Window[] = [];
    if (start > w.start) out.push({ ...w, end: start });
    if (end < w.end) out.push({ ...w, start: end });
    return out;
  });
}

/** Coaching windows (minutes after midnight) for one London date. */
export function windowsForDate(date: string, rules: AvailabilityRule[], exceptions: AvailabilityException[]): Window[] {
  const dayExc = exceptions.filter((e) => e.date === date);
  if (dayExc.some((e) => e.kind === "blocked" && !e.start_time)) return [];

  let windows: Window[] = rules
    .filter((r) => r.weekday === weekdayOf(date))
    .map((r) => ({ start: toMinutes(r.start_time), end: toMinutes(r.end_time), location: r.location }));
  for (const e of dayExc.filter((e) => e.kind === "extra" && e.start_time)) {
    windows.push({ start: toMinutes(e.start_time!), end: toMinutes(e.end_time!), location: e.location });
  }
  for (const e of dayExc.filter((e) => e.kind === "blocked" && e.start_time)) {
    windows = subtract(windows, toMinutes(e.start_time!), toMinutes(e.end_time!));
  }
  // merge overlaps
  windows.sort((a, b) => a.start - b.start);
  const merged: Window[] = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }
  return merged;
}

export function isActiveBooking(b: ExistingBooking, now: Date): boolean {
  if (b.status === "confirmed") return true;
  if (b.status !== "pending") return false;
  return !b.hold_expires_at || new Date(b.hold_expires_at) > now;
}

export function computeSlots(opts: {
  service: SlotService;
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
  bookings: ExistingBooking[];
  now: Date;
  days: number;
  noticeHours: number;
  excludeBookingId?: string;
}): DaySlots[] {
  const { service, now } = opts;
  const earliest = now.getTime() + opts.noticeHours * 60 * MS_MIN;
  const active = opts.bookings
    .filter((b) => b.id !== opts.excludeBookingId && isActiveBooking(b, now))
    .map((b) => ({ ...b, s: new Date(b.start_at).getTime(), e: new Date(b.end_at).getTime() }));
  const duration = service.duration_minutes;
  // Groups and camps run as fixed sessions so players land in the same group;
  // 1-to-1s can start every 30 minutes (or every slot length if shorter).
  const step = service.type === "one_to_one" ? Math.min(30, duration) : duration;

  const today = londonDate(now);
  const result: DaySlots[] = [];
  for (let i = 0; i < opts.days; i++) {
    const date = addDays(today, i);
    const slots: Slot[] = [];
    for (const w of windowsForDate(date, opts.rules, opts.exceptions)) {
      for (let t = w.start; t + duration <= w.end; t += step) {
        const start = londonToUtc(date, t);
        const s = start.getTime();
        const e = s + duration * MS_MIN;
        if (s < earliest) continue;
        const overlapping = active.filter((b) => b.s < e && b.e > s);
        let spotsLeft: number;
        if (service.type === "one_to_one") {
          if (overlapping.length) continue;
          spotsLeft = 1;
        } else {
          const key = groupSlotKey(service.id, start);
          if (overlapping.some((b) => b.slot_key !== key)) continue;
          spotsLeft = service.max_participants - overlapping.length;
          if (spotsLeft <= 0) continue;
        }
        slots.push({ start: start.toISOString(), end: new Date(e).toISOString(), spotsLeft, location: w.location });
      }
    }
    if (slots.length) result.push({ date, slots });
  }
  return result;
}

/** Is this exact start time currently bookable? */
export function findSlot(days: DaySlots[], startIso: string): Slot | undefined {
  const target = new Date(startIso).getTime();
  for (const d of days) for (const s of d.slots) if (new Date(s.start).getTime() === target) return s;
  return undefined;
}

export function formatSlotTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export function formatSlotDate(iso: string, opts: { long?: boolean } = {}): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    weekday: opts.long ? "long" : "short",
    day: "numeric",
    month: opts.long ? "long" : "short",
  }).format(new Date(iso));
}
