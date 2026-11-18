import { londonDate } from "./slots";

export type EarningRow = { start_at: string; status: string; payment_status: string; price_pence: number; platform_fee_pence: number };

/** Money a coach has taken (after any CoachBook fee, before Stripe's own fees). */
export function summariseEarnings(rows: EarningRow[], now: Date) {
  const paid = rows.filter((r) => r.payment_status === "paid" && ["confirmed", "completed", "no_show"].includes(r.status));
  const net = (r: EarningRow) => r.price_pence - r.platform_fee_pence;
  const month = londonDate(now).slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const lastMonth = new Date(Date.UTC(y, m - 2, 15)).toISOString().slice(0, 7);
  const sum = (list: EarningRow[]) => list.reduce((t, r) => t + net(r), 0);
  return {
    thisMonth: sum(paid.filter((r) => londonDate(new Date(r.start_at)).startsWith(month))),
    lastMonth: sum(paid.filter((r) => londonDate(new Date(r.start_at)).startsWith(lastMonth))),
    upcoming: sum(paid.filter((r) => new Date(r.start_at) >= now)),
    allTime: sum(paid),
  };
}
