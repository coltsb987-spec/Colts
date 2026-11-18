import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireRole } from "@/lib/auth";

const links = [
  { href: "/coach", label: "Overview" },
  { href: "/coach/profile", label: "Profile" },
  { href: "/coach/services", label: "Sessions & prices" },
  { href: "/coach/availability", label: "Availability" },
];

export default async function CoachLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireRole("coach");
  return (
    <DashboardShell home="/coach" links={links} name={profile.full_name}>
      {children}
    </DashboardShell>
  );
}
