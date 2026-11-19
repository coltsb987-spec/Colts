import type { ServiceType } from "./types";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Display order for UK users: Monday first.
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  one_to_one: "1-to-1",
  group: "Small group",
  camp: "Camp",
};

export function formatPrice(pence: number): string {
  if (pence === 0) return "Free";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: pence % 100 === 0 ? 0 : 2,
  }).format(pence / 100);
}

/** "16:00:00" -> "16:00" */
export function formatTime(t: string): string {
  return t.slice(0, 5);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** "M1 1AE" -> "M1": only the area is shown publicly. */
export function postcodeArea(postcode: string | null): string | null {
  if (!postcode) return null;
  const compact = postcode.replace(/\s+/g, "").toUpperCase();
  // A full postcode ends in digit + 2 letters (the inward code); show only the part before it.
  return /\d[A-Z]{2}$/.test(compact) && compact.length > 4 ? compact.slice(0, -3) : compact;
}
