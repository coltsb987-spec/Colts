// Phase 2 end-to-end test: booking, Stripe Checkout, webhooks, coach dashboard.
// Runs against LOCAL Supabase + `npm run dev` with Stripe TEST keys. Needs in the environment:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, CRON_SECRET
// Stripe's own pages (onboarding, card form) can't be automated, so the test checks that we send
// people there correctly, then plays Stripe's part by sending signed webhook events.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const Stripe = require("stripe");

const APP = process.env.APP_URL ?? "http://localhost:3000";
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY;
const SHOTS = process.argv[2];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
const run = Date.now().toString(36);
const slug = `p2-coach-${run}`;
const users = [];
let stripeAccount = null;

const ok = (m) => console.log(`ok - ${m}`);
const fail = (m) => { throw new Error(`FAIL: ${m}`); };
const shot = (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const db = async (path, init = {}) => {
  const res = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, Prefer: "return=representation", ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) fail(`db ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
};

async function signIn(page, as, email, name, next) {
  const res = await fetch(`${SB}/auth/v1/admin/generate_link`, { method: "POST", headers: H, body: JSON.stringify({ type: "magiclink", email, data: { role: as, full_name: name } }) });
  const body = await res.json();
  if (!res.ok) fail(`generate_link ${JSON.stringify(body)}`);
  users.push(body.id ?? body.user?.id);
  await page.goto(`${APP}/auth/confirm?next=${encodeURIComponent(next ?? `/${as}`)}&token_hash=${body.hashed_token ?? body.properties?.hashed_token}&type=email`);
}

async function sendWebhook(event, secret = process.env.STRIPE_WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const res = await fetch(`${APP}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": header, "content-type": "application/json" }, body: payload });
  return { status: res.status, body: await res.json() };
}

/** Clicks the submit button and returns the Stripe URL we were sent to (without loading Stripe). */
async function captureStripeRedirect(page, host, click) {
  let url = null;
  const stub = (route) => { url = route.request().url(); return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Stripe (stubbed in test)</h1>" }); };
  const match = (u) => u.hostname.endsWith("stripe.com");
  await page.context().route(match, stub);
  // Our server answers with a redirect to Stripe; read where it points (the browser can't reach Stripe here).
  const onResp = (r) => {
    const loc = r.headers().location;
    if (r.status() >= 300 && r.status() < 400 && loc && new URL(loc).hostname.endsWith("stripe.com")) url = loc;
  };
  page.on("response", onResp);
  await click();
  for (let i = 0; i < 80 && !url; i++) await page.waitForTimeout(250);
  await page.context().unroute(match, stub);
  page.off("response", onResp);
  return url;
}

const browser = await chromium.launch();
try {
  // ---------------- Coach setup ----------------
  const coachCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const cp = await coachCtx.newPage();
  await signIn(cp, "coach", `p2-coach-${run}@example.com`, "Jo Coach");
  await cp.waitForURL(`${APP}/coach**`);
  await cp.goto(`${APP}/coach/profile`);
  await cp.fill('input[name="business_name"]', `Jo Coaching ${run}`);
  await cp.fill('input[name="slug"]', slug);
  await cp.click('button[type="submit"]');
  await cp.waitForURL(`${APP}/coach/services**`);
  const addService = async (name, type, price, max) => {
    await cp.selectOption('select[name="type"] >> nth=-1', type);
    await cp.fill('input[name="name"] >> nth=-1', name);
    await cp.fill('input[name="price"] >> nth=-1', price);
    if (max) await cp.fill('input[name="max_participants"] >> nth=-1', max);
    await cp.click('button:has-text("Add session")');
    await cp.getByText(`Added “${name}”`).waitFor();
  };
  await addService("1-to-1 session", "one_to_one", "35");
  await addService("Free taster", "group", "0", "2");
  await cp.goto(`${APP}/coach/availability`);
  for (const [d, n] of [[0, "Sunday"], [1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"], [5, "Friday"], [6, "Saturday"]]) {
    await cp.selectOption('select[name="weekday"]', String(d));
    await cp.fill('input[name="start_time"] >> nth=0', "09:00");
    await cp.fill('input[name="end_time"] >> nth=0', "20:00");
    await cp.click('button:has-text("Add hours")');
    await cp.getByText(`Added ${n} 09:00–20:00.`).waitFor();
  }
  await cp.goto(`${APP}/coach`);
  await cp.click('button:has-text("Publish page")');
  await cp.getByRole("button", { name: "Hide page" }).waitFor();
  ok("coach set up: 1-to-1 £35 + free group taster, hours every day, published");

  // Public page: only the free session is bookable until Stripe is connected
  await cp.goto(`${APP}/${slug}`);
  if ((await cp.getByRole("link", { name: "Book", exact: true }).count()) !== 1) fail("expected only the free session to be bookable before Stripe");
  ok("before Stripe: only free sessions can be booked");

  // ---------------- Stripe Connect onboarding ----------------
  await cp.goto(`${APP}/coach/payments`);
  await shot(cp, "p2-01-payments-before");
  const onboardUrl = await captureStripeRedirect(cp, "connect.stripe.com", () => cp.click('button:has-text("Connect Stripe")'));
  if (!onboardUrl?.startsWith("https://connect.stripe.com/")) fail(`not sent to Stripe onboarding: ${onboardUrl}`);
  const [coachRow] = await db(`coaches?slug=eq.${slug}&select=id,stripe_account_id`);
  stripeAccount = coachRow.stripe_account_id;
  if (!stripeAccount?.startsWith("acct_")) fail("no Stripe account saved");
  ok(`"Connect Stripe" creates the coach's Stripe account (${stripeAccount.slice(0, 10)}…) and opens Stripe's sign-up`);
  // Stripe's form can't be automated; pretend the coach finished it.
  await db(`coaches?id=eq.${coachRow.id}`, { method: "PATCH", body: JSON.stringify({ stripe_charges_enabled: true }) });
  await cp.goto(`${APP}/coach/payments`);
  await cp.getByText("Ready", { exact: true }).waitFor();
  await shot(cp, "p2-02-payments-ready");
  ok("payments page shows Ready once Stripe has approved the coach");

  // Subscription checkout opens Stripe (trial, no card needed)
  const subUrl = await captureStripeRedirect(cp, "checkout.stripe.com", () => cp.click('button:has-text("Start plan")'));
  if (!subUrl?.startsWith("https://checkout.stripe.com/")) fail(`subscription checkout not opened: ${subUrl}`);
  ok("\"Start plan\" opens Stripe Checkout for the £40/month plan");

  // ---------------- Parent books a paid 1-to-1 ----------------
  const services = await db(`services?coach_id=eq.${coachRow.id}&select=id,name`);
  const paidId = services.find((s) => s.name === "1-to-1 session").id;
  const freeId = services.find((s) => s.name === "Free taster").id;
  const parentCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pp = await parentCtx.newPage();
  await pp.goto(`${APP}/${slug}`);
  if ((await pp.getByRole("link", { name: "Book", exact: true }).count()) !== 2) fail("both sessions should be bookable now");
  await pp.getByRole("link", { name: "Book", exact: true }).first().click();
  await pp.waitForURL(/\/login\?as=parent/);
  ok("signed-out parent clicking Book is asked to sign in");
  await signIn(pp, "parent", `p2-parent-${run}@example.com`, "Pat Parent", `/${slug}/book/${paidId}`);
  await pp.waitForURL(`${APP}/${slug}/book/${paidId}`);
  ok("after sign-in the parent lands back on the booking page");

  const firstTime = pp.locator("fieldset button").first();
  const chosenLabel = (await firstTime.innerText()).trim();
  await firstTime.click();
  await pp.fill('input[name="first_name"]', "Leo");
  await pp.selectOption('select[name="age_group"]', "U10");
  await pp.check('input[name="consent"]');
  await shot(pp, "p2-03-booking-form");
  const checkoutUrl = await captureStripeRedirect(pp, "checkout.stripe.com", () => pp.click('button:has-text("Continue to payment")'));
  if (!checkoutUrl?.startsWith("https://checkout.stripe.com/")) fail(`not sent to Stripe Checkout: ${checkoutUrl}`);
  let [booking] = await db(`bookings?service_id=eq.${paidId}&select=*`);
  if (booking.status !== "pending" || !booking.stripe_checkout_session_id) fail(`booking not pending with session: ${JSON.stringify(booking)}`);
  const session = await stripe.checkout.sessions.retrieve(booking.stripe_checkout_session_id, {}, { stripeAccount });
  if (session.amount_total !== 3500 || session.currency !== "gbp" || session.metadata.booking_id !== booking.id) fail("checkout session has wrong amount/metadata");
  ok(`parent picked ${chosenLabel}, added player with consent, and was sent to Stripe Checkout for £35 on the coach's account`);

  // ---------------- Stripe says "paid" (signed webhook) ----------------
  const paidEvent = {
    id: `evt_test_${run}`, object: "event", type: "checkout.session.completed", account: stripeAccount, created: Math.floor(Date.now() / 1000),
    data: { object: { id: session.id, object: "checkout.session", mode: "payment", payment_status: "paid", payment_intent: `pi_test_${run}`, metadata: { booking_id: booking.id } } },
  };
  const bad = await sendWebhook(paidEvent, "whsec_wrong");
  if (bad.status !== 400) fail("webhook with bad signature accepted");
  ok("webhook rejects events with a bad signature");
  const w1 = await sendWebhook(paidEvent);
  if (w1.status !== 200) fail(`webhook failed: ${JSON.stringify(w1)}`);
  [booking] = await db(`bookings?id=eq.${booking.id}&select=*`);
  if (booking.status !== "confirmed" || booking.payment_status !== "paid") fail(`booking not confirmed: ${booking.status}/${booking.payment_status}`);
  const w2 = await sendWebhook(paidEvent);
  if (!w2.body.duplicate) fail("duplicate webhook not detected");
  ok("payment webhook confirms the booking as paid; repeat deliveries are ignored");

  await pp.goto(`${APP}/parent/bookings/${booking.id}`);
  await pp.getByText("Confirmed · Paid").waitFor();
  await shot(pp, "p2-04-parent-booking");
  await pp.goto(`${APP}/parent/bookings`);
  await pp.getByText("1-to-1 session").first().waitFor();
  ok("parent sees the confirmed booking in My bookings");

  // The booked time is no longer offered
  await pp.goto(`${APP}/${slug}/book/${paidId}`);
  const times = (await pp.locator("fieldset button").allInnerTexts()).map((t) => t.trim());
  if (times.includes(chosenLabel)) fail("booked time still offered");
  ok(`the booked time (${chosenLabel}) is no longer offered to others`);

  // Abandon a second checkout: slot released
  await pp.locator("fieldset button").first().click();
  await captureStripeRedirect(pp, "checkout.stripe.com", () => pp.click('button:has-text("Continue to payment")'));
  const pending = (await db(`bookings?service_id=eq.${paidId}&status=eq.pending&select=id,stripe_checkout_session_id`))[0];
  await pp.goto(`${APP}/parent/bookings/${pending.id}?cancelled=1`);
  await pp.getByText("Payment cancelled").waitFor();
  const [released] = await db(`bookings?id=eq.${pending.id}&select=status`);
  const expired = await stripe.checkout.sessions.retrieve(pending.stripe_checkout_session_id, {}, { stripeAccount });
  if (released.status !== "cancelled" || expired.status !== "expired") fail("abandoned checkout not released");
  ok("leaving Stripe without paying releases the time and closes the payment page");

  // ---------------- Free group taster ----------------
  await pp.goto(`${APP}/${slug}/book/${freeId}`);
  await pp.locator("fieldset button").first().click();
  await pp.click('button:has-text("Confirm booking")');
  await pp.waitForURL(/\/parent\/bookings\/.+booked=1/);
  await pp.getByText("You're booked in!").waitFor();
  ok("free session books instantly using the saved player (no payment)");

  // ---------------- Coach dashboard ----------------
  await cp.goto(`${APP}/coach/bookings`);
  await cp.getByText("Leo (U10)").first().waitFor();
  const bookedAhead = await cp.locator("text=Booked ahead").locator("xpath=..").innerText();
  if (!bookedAhead.includes("£35")) fail(`earnings wrong: ${bookedAhead}`);
  await shot(cp, "p2-05-coach-bookings");
  ok("coach sees both sessions with player details, and £35 booked ahead");

  // Move the free session
  const [freeBooking] = await db(`bookings?service_id=eq.${freeId}&status=eq.confirmed&select=id,start_at`);
  await cp.goto(`${APP}/coach/bookings/${freeBooking.id}/reschedule`);
  await cp.locator("[role=radiogroup] button").nth(2).click();
  await cp.locator("fieldset button").first().click();
  await shot(cp, "p2-06-reschedule");
  await cp.click('button:has-text("Move to this time")');
  await cp.waitForURL(/moved=1/);
  const [movedRow] = await db(`bookings?id=eq.${freeBooking.id}&select=start_at`);
  if (movedRow.start_at === freeBooking.start_at) fail("session not moved");
  ok("coach moved a session to another day");

  // Cancel the paid one: the fake test payment can't be refunded, so it must stay confirmed
  cp.on("dialog", (d) => d.accept());
  const paidCard = cp.locator("li", { hasText: "1-to-1 session" });
  await paidCard.getByRole("button", { name: "Cancel" }).click();
  await paidCard.getByText("refund didn't go through").waitFor();
  [booking] = await db(`bookings?id=eq.${booking.id}&select=status`);
  if (booking.status !== "confirmed") fail("booking cancelled even though refund failed");
  ok("if a refund fails, the booking is NOT cancelled (parent never loses money)");

  // Cancel the free one
  await cp.locator("li", { hasText: "Free taster" }).getByRole("button", { name: "Cancel" }).click();
  await cp.waitForTimeout(1500);
  const [freeAfter] = await db(`bookings?id=eq.${freeBooking.id}&select=status,cancelled_by`);
  if (freeAfter.status !== "cancelled" || freeAfter.cancelled_by !== "coach") fail("free booking not cancelled");
  ok("coach cancelled the free session");

  // ---------------- Reminders job ----------------
  const noAuth = await fetch(`${APP}/api/cron/reminders`);
  const withAuth = await fetch(`${APP}/api/cron/reminders`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  if (noAuth.status !== 401 || withAuth.status !== 200) fail(`cron auth wrong: ${noAuth.status}/${withAuth.status}`);
  ok(`reminder job is protected and runs (${JSON.stringify(await withAuth.json())})`);

  // ---------------- Security: parent can't see the coach area or others' bookings ----------------
  await pp.goto(`${APP}/coach/bookings`);
  if (!pp.url().includes("/parent")) fail("parent reached coach bookings");
  ok("parent is kept out of the coach bookings page");
  console.log("ALL PHASE 2 CHECKS PASSED");
} finally {
  await browser.close();
  for (const id of users.filter(Boolean)) await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: H });
  if (stripeAccount) await stripe.v2.core.accounts.close(stripeAccount, { applied_configurations: ["merchant"] }).catch(() => undefined);
  console.log(`cleanup - removed ${users.length} test users${stripeAccount ? " and the test Stripe account" : ""}`);
}
