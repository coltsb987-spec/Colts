import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/validation";

// The magic link in the email lands here. Supports both link styles:
//  - ?token_hash=...&type=email  (recommended email template, works across devices)
//  - ?code=...                    (Supabase default template, same browser only)
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createClient();
  let ok = false;
  if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }
  if (!ok) return NextResponse.redirect(new URL("/auth/error", origin));

  // Send each person to their own area, whatever link they used.
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user!.id).single();
  const home = profile?.role === "coach" ? "/coach" : "/parent";
  let next = safeNextPath(searchParams.get("next"), home);
  if (!next.startsWith(home) && (next.startsWith("/coach") || next.startsWith("/parent"))) next = home;
  return NextResponse.redirect(new URL(next, origin));
}
