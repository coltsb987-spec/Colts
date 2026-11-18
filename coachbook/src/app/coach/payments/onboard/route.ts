import { NextResponse, type NextRequest } from "next/server";
import { getMyCoach } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site";
import { stripe } from "@/lib/stripe";

// Starts (or continues) Stripe onboarding for the signed-in coach.
// POST from the Payments page; GET is used by Stripe when a link has expired.
async function onboard(_req: NextRequest) {
  const { coach, user } = await getMyCoach();
  if (!coach) return NextResponse.redirect(`${siteUrl()}/coach/profile`, 303);

  let accountId = coach.stripe_account_id;
  try {
    if (!accountId) {
      // Each coach gets their own full Stripe account. Stripe handles disputes and losses with
      // the coach directly; CoachBook carries no chargeback risk.
      const account = await stripe().v2.core.accounts.create({
        contact_email: user.email!,
        display_name: coach.business_name,
        dashboard: "full",
        identity: { country: "gb" },
        defaults: {
          currency: "gbp",
          responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
          // Pre-filled so the coach has less to type in Stripe's form.
          profile: {
            product_description: "Football coaching sessions",
            // Stripe only accepts public web addresses (not localhost during development).
            ...(siteUrl().startsWith("https://") ? { business_url: `${siteUrl()}/${coach.slug}` } : {}),
          },
        },
        configuration: { merchant: { mcc: "8299", capabilities: { card_payments: { requested: true } } } },
        metadata: { coach_id: coach.id },
      });
      accountId = account.id;
      await createAdminClient().from("coaches").update({ stripe_account_id: accountId }).eq("id", coach.id);
    }
    const link = await stripe().v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          refresh_url: `${siteUrl()}/coach/payments/onboard`,
          return_url: `${siteUrl()}/coach/payments?stripe=return`,
        },
      },
    });
    return NextResponse.redirect(link.url, 303);
  } catch (e) {
    console.error("stripe onboarding failed", e);
    return NextResponse.redirect(`${siteUrl()}/coach/payments?stripe=error`, 303);
  }
}

export const GET = onboard;
export const POST = onboard;
