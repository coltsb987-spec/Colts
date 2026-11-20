import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { emailLayout, sendEmail } from "@/lib/email";
import { siteUrl } from "@/lib/site";

// Owner-only check that email sending works (Resend + EMAIL_FROM).
// POST with "Authorization: Bearer <CRON_SECRET>" and {"to": "you@example.com"}.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const parsed = z.object({ to: z.email() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send {\"to\": \"an email address\"}" }, { status: 400 });
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: "RESEND_API_KEY is not set" }, { status: 500 });

  const result = await sendEmail({
    to: parsed.data.to,
    subject: "CoachBook UK test email",
    ...emailLayout({
      heading: "Your emails are working",
      lines: [
        "This is a test from CoachBook UK, sent through Resend from your mycoachbook.co.uk domain.",
        "Booking confirmations, cancellations, reminders and receptionist hand-offs will now arrive like this.",
      ],
      cta: { label: "Open CoachBook UK", url: siteUrl() },
    }),
  });
  return NextResponse.json({ sent: result.ok === true, from: process.env.EMAIL_FROM ?? "(default sender)" }, { status: result.ok ? 200 : 502 });
}
