import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/** Copies a Stripe subscription into our database (subscriptions table + coach status). */
export async function syncSubscription(sub: Stripe.Subscription) {
  const admin = createAdminClient();
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  let coachId = sub.metadata?.coach_id;
  if (!coachId) {
    const { data } = await admin.from("coaches").select("id").eq("stripe_customer_id", customerId).maybeSingle();
    coachId = data?.id;
  }
  if (!coachId) {
    console.warn("subscription for unknown coach", sub.id);
    return;
  }
  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
  const periodEnd = item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;

  await admin.from("subscriptions").upsert(
    {
      coach_id: coachId,
      stripe_subscription_id: sub.id,
      plan: item?.price?.lookup_key ?? item?.price?.id ?? "coach",
      status: sub.status,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    },
    { onConflict: "stripe_subscription_id" },
  );
  await admin.from("coaches").update({ subscription_status: sub.status }).eq("id", coachId);
}
