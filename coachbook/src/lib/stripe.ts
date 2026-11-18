import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;

export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY, {
    // fetch works everywhere (Vercel, local, behind proxies)
    httpClient: Stripe.createFetchHttpClient(),
    appInfo: { name: "CoachBook UK" },
  });
  return client;
}

/** Optional platform fee on each booking, as a percentage (default 0 during the pilot). */
export function platformFeePence(pricePence: number): number {
  const pct = Number(process.env.PLATFORM_FEE_PERCENT ?? 0);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.round((pricePence * Math.min(pct, 50)) / 100);
}

/** Coaches may take bookings while piloting, trialling or paying. */
export const BOOKABLE_SUBSCRIPTION_STATUSES = ["pilot", "trialing", "active", "past_due"];

export const SUBSCRIPTION_LOOKUP_KEY = "coachbook_monthly";
export const SUBSCRIPTION_PRICE_PENCE = 4000;

export function trialDays(): number {
  const n = Number(process.env.SUBSCRIPTION_TRIAL_DAYS ?? 60);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 730) : 60;
}

/** Finds (or creates once) the £40/month price in Stripe. */
export async function subscriptionPriceId(): Promise<string> {
  const s = stripe();
  const existing = await s.prices.list({ lookup_keys: [SUBSCRIPTION_LOOKUP_KEY], active: true, limit: 1 });
  if (existing.data[0]) return existing.data[0].id;
  const product = await s.products.create({ name: "CoachBook UK – Coach plan", description: "Booking page, online payments and AI receptionist" });
  const price = await s.prices.create({
    product: product.id,
    currency: "gbp",
    unit_amount: SUBSCRIPTION_PRICE_PENCE,
    recurring: { interval: "month" },
    lookup_key: SUBSCRIPTION_LOOKUP_KEY,
  });
  return price.id;
}

/** Can this connected account take card payments yet? */
export async function refreshChargesEnabled(accountId: string): Promise<boolean> {
  const acct = await stripe().v2.core.accounts.retrieve(accountId, { include: ["configuration.merchant"] });
  return acct.configuration?.merchant?.capabilities?.card_payments?.status === "active";
}
