import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/env";

// Server-only client using the SECRET key. It bypasses row-level security, so only
// use it after checking who the user is, and never send its results to the browser unchecked.
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not set");
  return createSupabaseClient(supabaseConfig().url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getUserEmail(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await createAdminClient().auth.admin.getUserById(userId);
  return data.user?.email ?? null;
}
