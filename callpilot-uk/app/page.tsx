import { Dashboard } from "@/components/Dashboard";
import { SetupNeeded } from "@/components/SetupNeeded";
import { loadDashboard } from "@/lib/dashboard";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!hasSupabaseEnv()) return <SetupNeeded />;
  const data = await loadDashboard(createClient());
  return <Dashboard data={data} />;
}
