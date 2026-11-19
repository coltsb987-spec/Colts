import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireRole } from "@/lib/auth";

const links = [
  { href: "/coach", label: "Overview" },
  { href: "/coach/bookings", label: "Bookings" },
  { href: "/coach/messages", label: "Messages" },
  { href: "/coach/profile", label: "Profile" },
  { href: "/coach/services", label: "Sessions & prices" },
  { href: "/coach/availability", label: "Availability" },
  { href: "/coach/payments", label: "Payments" },
  { href: "/coach/receptionist", label: "Receptionist" },
];

export default async function CoachLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireRole("coach");
  return (
    <DashboardShell home="/coach" links={links} name={profile.full_name}>
      {children}
    </DashboardShell>
  );
}
