"use server";

import { redirect } from "next/navigation";
import { getMyCoach } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site";
import { stripe, subscriptionPriceId, trialDays } from "@/lib/stripe";
import type { ActionState } from "@/lib/types";

async function customerFor(coach: { id: string; business_name: string }, email: string | undefined) {
  const admin = createAdminClient();
  const { data } = await admin.from("coaches").select("stripe_customer_id").eq("id", coach.id).single();
  if (data?.stripe_customer_id) return data.stripe_customer_id as string;
  const customer = await stripe().customers.create({ email, name: coach.business_name, metadata: { coach_id: coach.id } });
  await admin.from("coaches").update({ stripe_customer_id: customer.id }).eq("id", coach.id);
  return customer.id;
}

export async function startSubscription(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  const { coach, user } = await getMyCoach();
  if (!coach) redirect("/coach/profile");
  let url: string | null = null;
  try {
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer: await customerFor(coach, user.email),
      line_items: [{ price: await subscriptionPriceId(), quantity: 1 }],
      // Free trial without needing a card; if no card is added by the end, it simply stops.
      payment_method_collection: "if_required",
      subscription_data: {
        trial_period_days: trialDays() || undefined,
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        metadata: { coach_id: coach.id },
      },
      metadata: { coach_id: coach.id },
      success_url: `${siteUrl()}/coach/payments?subscribed={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl()}/coach/payments`,
    });
    url = session.url;
  } catch (e) {
    console.error("subscription checkout failed", e);
    return { error: "Couldn't open Stripe. Please try again." };
  }
  redirect(url!);
}

export async function openBillingPortal(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  const { coach, user } = await getMyCoach();
  if (!coach) redirect("/coach/profile");
  let url: string | null = null;
  try {
    const portal = await stripe().billingPortal.sessions.create({
      customer: await customerFor(coach, user.email),
      return_url: `${siteUrl()}/coach/payments`,
    });
    url = portal.url;
  } catch (e) {
    console.error("billing portal failed", e);
    return { error: "Billing management isn't available yet – contact CoachBook support." };
  }
  redirect(url!);
}
