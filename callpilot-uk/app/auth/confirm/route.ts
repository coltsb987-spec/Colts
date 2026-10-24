import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/routes";

const OTP_TYPES: EmailOtpType[] = ["signup", "email", "recovery", "invite", "magiclink", "email_change"];

// Handles the link in Supabase confirmation emails (PKCE `code` or `token_hash` templates).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeRedirectPath(params.get("next"));
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const supabase = createClient();

  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  }

  const target = new URL(ok ? next : "/login?error=link", request.nextUrl.origin);
  return NextResponse.redirect(target);
}
