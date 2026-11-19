import { NextResponse, type NextRequest } from "next/server";
import { getBookingDetails, sendReminder } from "@/lib/bookings";
import { createAdminClient } from "@/lib/supabase/admin";

// Runs once a day (see vercel.json). Emails parents about sessions in roughly the
// next day. Vercel sends "Authorization: Bearer <CRON_SECRET>" automatically.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  // Without email set up, don't mark anything as reminded – try again once email works.
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ checked: 0, sent: 0, skipped: "RESEND_API_KEY not set" });

  const admin = createAdminClient();
  const now = Date.now();
  const { data } = await admin
    .from("bookings")
    .select("id, start_at, created_at")
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .gt("start_at", new Date(now).toISOString())
    .lte("start_at", new Date(now + 30 * 3600_000).toISOString());

  let sent = 0;
  for (const row of data ?? []) {
    // Skip sessions booked within the last day – the confirmation email was enough.
    if (Date.parse(row.start_at) - Date.parse(row.created_at) < 24 * 3600_000) continue;
    // Claim it first so two runs can't both send.
    const { data: claimed } = await admin
      .from("bookings")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("reminder_sent_at", null)
      .select("id");
    if (!claimed?.length) continue;
    const b = await getBookingDetails(row.id);
    if (b) {
      await sendReminder(b);
      sent++;
    }
  }
  return NextResponse.json({ checked: data?.length ?? 0, sent });
}
