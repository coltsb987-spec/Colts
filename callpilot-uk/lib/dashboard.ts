import type { SupabaseClient } from "@supabase/supabase-js";

export type BusinessStatus = "setup_needed" | "active" | "paused";
export type CallOutcome = "answered" | "lead_captured" | "booking_requested" | "transferred" | "missed";

export type Business = {
  id: string;
  name: string;
  businessType: string;
  status: BusinessStatus;
  phoneNumber: string | null;
  callCount: number;
};

export type CallRecord = {
  id: string;
  businessId: string;
  businessName: string;
  startedAt: string;
  durationSeconds: number;
  outcome: CallOutcome;
  summary: string | null;
  isTest: boolean;
};

export type CallStats = {
  totalCalls: number;
  leadsCaptured: number;
  bookingRequests: number;
  avgDurationSeconds: number;
};

export type DashboardData = {
  user: { id: string; email: string };
  workspace: { id: string; name: string; role: string };
  businesses: Business[];
  recentCalls: CallRecord[];
  stats: CallStats;
};

export class DashboardError extends Error {}

type BusinessRow = {
  id: string;
  name: string;
  business_type: string;
  status: BusinessStatus;
  phone_number: string | null;
  calls: { count: number }[] | null;
};

type CallRow = {
  id: string;
  business_id: string;
  started_at: string;
  duration_seconds: number;
  outcome: CallOutcome;
  summary: string | null;
  is_test: boolean;
};

type StatsRow = {
  total_calls: number | string;
  leads_captured: number | string;
  booking_requests: number | string;
  avg_duration_seconds: number | string;
};

export function mapBusiness(row: BusinessRow): Business {
  return {
    id: row.id,
    name: row.name,
    businessType: row.business_type,
    status: row.status,
    phoneNumber: row.phone_number,
    callCount: row.calls?.[0]?.count ?? 0,
  };
}

export function mapStats(row: StatsRow | undefined | null): CallStats {
  return {
    totalCalls: Number(row?.total_calls ?? 0),
    leadsCaptured: Number(row?.leads_captured ?? 0),
    bookingRequests: Number(row?.booking_requests ?? 0),
    avgDurationSeconds: Number(row?.avg_duration_seconds ?? 0),
  };
}

export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export async function loadDashboard(supabase: SupabaseClient): Promise<DashboardData> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) throw new DashboardError("You are not signed in.");

  // Stage 1 shows the user's first workspace; a workspace switcher comes with invitations.
  const { data: membership, error: memberError } = await supabase
    .from("workspace_members")
    .select("role, workspaces ( id, name )")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (memberError) throw new DashboardError("Could not load your workspace.");
  const ws = (membership?.workspaces ?? null) as unknown as { id: string; name: string } | null;
  if (!membership || !ws) throw new DashboardError("No workspace found for your account.");

  const [businessesRes, callsRes, statsRes] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, business_type, status, phone_number, calls ( count )")
      .eq("workspace_id", ws.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("calls")
      .select("id, business_id, started_at, duration_seconds, outcome, summary, is_test")
      .eq("workspace_id", ws.id)
      .order("started_at", { ascending: false })
      .limit(20),
    supabase.rpc("workspace_call_stats", { target_workspace: ws.id }),
  ]);
  if (businessesRes.error) throw new DashboardError("Could not load businesses.");
  if (callsRes.error) throw new DashboardError("Could not load call activity.");
  if (statsRes.error) throw new DashboardError("Could not load call statistics.");

  const businesses = (businessesRes.data as BusinessRow[]).map(mapBusiness);
  const names = new Map(businesses.map((b) => [b.id, b.name]));
  const recentCalls = (callsRes.data as CallRow[]).map((c) => ({
    id: c.id,
    businessId: c.business_id,
    businessName: names.get(c.business_id) ?? "Unknown business",
    startedAt: c.started_at,
    durationSeconds: c.duration_seconds,
    outcome: c.outcome,
    summary: c.summary,
    isTest: c.is_test,
  }));
  const statsRows = statsRes.data as StatsRow[] | StatsRow | null;

  return {
    user: { id: user.id, email: user.email ?? "" },
    workspace: { id: ws.id, name: ws.name, role: membership.role as string },
    businesses,
    recentCalls,
    stats: mapStats(Array.isArray(statsRows) ? statsRows[0] : statsRows),
  };
}
