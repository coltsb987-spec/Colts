import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireRole } from "@/lib/auth";

export default async function ParentLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireRole("parent");
  return (
    <DashboardShell home="/parent" links={[{ href: "/parent", label: "My players" }]} name={profile.full_name}>
      {children}
    </DashboardShell>
  );
}
