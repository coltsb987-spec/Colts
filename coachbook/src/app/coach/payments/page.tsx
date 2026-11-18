import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type Stripe from "stripe";
import { InlineAction } from "@/components/action-form";
import { Badge, Card, PageHeader, primaryButton, secondaryButton } from "@/components/ui";
import { getMyCoach } from "@/lib/auth";
import { formatPrice } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncSubscription } from "@/lib/subscriptions";
import { isStripeConfigured, refreshChargesEnabled, stripe, SUBSCRIPTION_PRICE_PENCE, trialDays } from "@/lib/stripe";
import { openBillingPortal, startSubscription } from "./actions";

export const metadata: Metadata = { title: "Payments" };

const PLAN_LABELS: Record<string, string> = {
  pilot: "Free pilot",
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment overdue",
  canceled: "Cancelled",
  incomplete: "Not finished",
  incomplete_expired: "Expired",
  unpaid: "Unpaid",
  paused: "Paused",
};

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ stripe?: string; subscribed?: string }> }) {
  const { coach, supabase } = await getMyCoach();
  if (!coach) redirect("/coach/profile");
  const sp = await searchParams;

  if (!isStripeConfigured()) {
    return (
      <>
        <PageHeader title="Payments" />
        <Card><p>Payments aren&apos;t switched on yet (Stripe keys missing).</p></Card>
      </>
    );
  }

  // Keep Stripe status fresh (after onboarding, or while verification is pending).
  let chargesEnabled = coach.stripe_charges_enabled;
  if (coach.stripe_account_id && !chargesEnabled) {
    try {
      chargesEnabled = await refreshChargesEnabled(coach.stripe_account_id);
      if (chargesEnabled) await createAdminClient().from("coaches").update({ stripe_charges_enabled: true }).eq("id", coach.id);
    } catch (e) {
      console.error("refresh charges failed", e);
    }
  }
  // Back from subscription checkout.
  let planStatus = coach.subscription_status;
  if (sp.subscribed?.startsWith("cs_")) {
    try {
      const session = await stripe().checkout.sessions.retrieve(sp.subscribed, { expand: ["subscription"] });
      if (session.metadata?.coach_id === coach.id && session.subscription && typeof session.subscription !== "string") {
        await syncSubscription(session.subscription as Stripe.Subscription);
        planStatus = (session.subscription as Stripe.Subscription).status;
      }
    } catch (e) {
      console.error("subscription sync failed", e);
    }
  }
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("coach_id", coach.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <>
      <PageHeader title="Payments" description="Get paid when parents book, and manage your CoachBook plan." />
      {sp.stripe === "error" && <p className="mb-4 rounded-xl border border-danger/30 bg-white px-4 py-3 text-danger">Couldn&apos;t open Stripe. Please try again.</p>}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Receive payments</h2>
          {chargesEnabled ? <Badge tone="accent">Ready</Badge> : coach.stripe_account_id ? <Badge tone="muted">Setup not finished</Badge> : <Badge tone="muted">Not connected</Badge>}
        </div>
        {chargesEnabled ? (
          <>
            <p className="mt-2 text-ink-soft">
              You&apos;re ready to take bookings. Parents pay by card when they book, and the money goes straight to your own Stripe account.
              Stripe pays it into your bank.
            </p>
            <a href="https://dashboard.stripe.com" target="_blank" rel="noreferrer" className={`${secondaryButton} mt-4`}>Open your Stripe dashboard</a>
          </>
        ) : (
          <>
            <p className="mt-2 text-ink-soft">
              CoachBook uses Stripe to take card payments. You&apos;ll create your own Stripe account (about 5 minutes) – have your bank details
              and some ID ready. Stripe&apos;s card fees are taken from each payment.
            </p>
            {sp.stripe === "return" && (
              <p className="mt-3 rounded-xl bg-white px-4 py-3 text-sm">Thanks! Stripe may need a few minutes to check your details. If something is missing, click Continue below.</p>
            )}
            <form action="/coach/payments/onboard" method="post" className="mt-4">
              <button className={primaryButton}>{coach.stripe_account_id ? "Continue Stripe setup" : "Connect Stripe"}</button>
            </form>
          </>
        )}
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Your CoachBook plan</h2>
          <Badge tone={["active", "trialing", "pilot"].includes(planStatus) ? "accent" : "muted"}>{PLAN_LABELS[planStatus] ?? planStatus}</Badge>
        </div>
        {planStatus === "pilot" ? (
          <>
            <p className="mt-2 text-ink-soft">
              You&apos;re on the free pilot – thank you for helping us build CoachBook. When you&apos;re ready, start the {formatPrice(SUBSCRIPTION_PRICE_PENCE)}/month plan
              {trialDays() > 0 && ` with a ${trialDays()}-day free trial (no card needed to start)`}.
            </p>
            <div className="mt-4"><InlineAction action={startSubscription} label="Start plan" variant="secondary" /></div>
          </>
        ) : ["canceled", "incomplete_expired", "unpaid"].includes(planStatus) ? (
          <>
            <p className="mt-2 text-ink-soft">Your plan isn&apos;t active, so parents can&apos;t book online. Restart it to take bookings again.</p>
            <div className="mt-4"><InlineAction action={startSubscription} label="Restart plan" variant="primary" /></div>
          </>
        ) : (
          <>
            <p className="mt-2 text-ink-soft">
              {formatPrice(SUBSCRIPTION_PRICE_PENCE)}/month.
              {sub?.current_period_end && ` ${planStatus === "trialing" ? "Trial ends" : "Renews"} ${new Date(sub.current_period_end).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`}
            </p>
            <div className="mt-4"><InlineAction action={openBillingPortal} label="Manage billing" variant="secondary" /></div>
          </>
        )}
      </Card>
    </>
  );
}
