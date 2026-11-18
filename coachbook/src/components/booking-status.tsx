import { Badge } from "./ui";

export function BookingStatusBadge({ status, payment, holdExpired }: { status: string; payment: string; holdExpired?: boolean }) {
  if (status === "confirmed") return <Badge tone="accent">{payment === "paid" ? "Confirmed · Paid" : "Confirmed"}</Badge>;
  if (status === "pending") return <Badge tone="muted">{holdExpired ? "Payment not completed" : "Awaiting payment"}</Badge>;
  if (status === "cancelled") return <Badge tone="muted">{payment === "refunded" ? "Cancelled · Refunded" : "Cancelled"}</Badge>;
  if (status === "completed") return <Badge>Completed</Badge>;
  if (status === "no_show") return <Badge tone="muted">No-show</Badge>;
  return <Badge>{status}</Badge>;
}
