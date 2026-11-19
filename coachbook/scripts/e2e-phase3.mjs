// Phase 3 end-to-end test: AI receptionist plumbing + coach settings + messages.
// Runs against LOCAL Supabase + `npm run dev` started with ANTHROPIC_BASE_URL pointing at
// scripts/mock-claude.mjs (a scripted stand-in, not a model). Needs in the environment:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, STRIPE_SECRET_KEY, MOCK_LOG (the mock's request log)
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
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
const slug = `p3-coach-${run}`;
const users = [];
let stripeAccount = null;

const ok = (m) => console.log(`ok - ${m}`);
const fail = (m) => { throw new Error(`FAIL: ${m}`); };
const shot = (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
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
  return body.id ?? body.user?.id;
}
async function chat(page, text) {
  const before = await page.locator("[role=dialog] .justify-start").count();
  await page.fill("#chat-input", text);
  await page.click("[role=dialog] button:has-text('Send')");
  await page.waitForFunction((n) => document.querySelectorAll("[role=dialog] .justify-start").length > n && !document.querySelector("[aria-label=Typing]"), before, { timeout: 30000 });
  return (await page.locator("[role=dialog] .justify-start").last().innerText()).trim();
}

const browser = await chromium.launch(process.env.E2E_BROWSER_PROXY ? { proxy: { server: process.env.E2E_BROWSER_PROXY } } : {});
try {
  // ---------- Coach with sessions, hours, Stripe (set up directly) ----------
  const cctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const cp = await cctx.newPage();
  const coachUser = await signIn(cp, "coach", `p3-coach-${run}@example.com`, "Ria Coach");
  await cp.waitForURL(`${APP}/coach**`);
  const acct = await stripe.v2.core.accounts.create({
    contact_email: `p3-coach-${run}@example.com`, display_name: "P3 test", dashboard: "full", identity: { country: "gb" },
    defaults: { currency: "gbp", responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
    configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
  });
  stripeAccount = acct.id;
  const [coach] = await db("coaches", { method: "POST", body: JSON.stringify({ profile_id: coachUser, business_name: `Ria Football ${run}`, slug, published: true, bio: "Grassroots coach.", stripe_account_id: acct.id, stripe_charges_enabled: true, booking_notice_hours: 2 }) });
  await db("services", { method: "POST", body: JSON.stringify([
    { coach_id: coach.id, name: "1-to-1 session", type: "one_to_one", duration_minutes: 60, price_pence: 3000, max_participants: 1 },
    { coach_id: coach.id, name: "Free taster", type: "group", duration_minutes: 60, price_pence: 0, max_participants: 4 },
  ]) });
  await db("availability_rules", { method: "POST", body: JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((d) => ({ coach_id: coach.id, weekday: d, start_time: "08:00", end_time: "21:00" }))) });
  ok("coach with two sessions, daily hours and Stripe ready");

  // ---------- Switch on the receptionist ----------
  await cp.goto(`${APP}/${slug}`);
  if (await cp.getByRole("button", { name: "Ask a question" }).count()) fail("chat shown before it was switched on");
  await cp.goto(`${APP}/coach/receptionist`);
  await cp.check('input[name="enabled"]');
  await cp.getByLabel("Question 1").fill("What should my child bring?");
  await cp.getByLabel("Answer 1").fill("Boots, shin pads and a full water bottle.");
  await cp.getByLabel("Question 2").fill("What happens if it rains?");
  await cp.getByLabel("Answer 2").fill("We play on unless there's lightning.");
  await cp.locator("li", { has: cp.getByLabel("Question 3") }).getByRole("button", { name: "Remove" }).click();
  await shot(cp, "p3-01-settings");
  await cp.click('button:has-text("Save settings")');
  await cp.getByText("Saved – your receptionist is on.").waitFor();
  const [saved] = await db(`coaches?id=eq.${coach.id}&select=receptionist_settings`);
  if (!saved.receptionist_settings.enabled || saved.receptionist_settings.faqs.length !== 2) fail(`settings not saved: ${JSON.stringify(saved)}`);
  ok("coach switched on the receptionist and saved 2 FAQs (blank one dropped)");

  // ---------- Anonymous visitor ----------
  const vctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const vp = await vctx.newPage();
  await vp.goto(`${APP}/${slug}`);
  await vp.getByRole("button", { name: "Ask a question" }).click();
  await vp.getByText(`I'm the AI assistant for Ria Football ${run}`).waitFor();
  ok("visitor sees the chat button and the default greeting");
  let reply = await chat(vp, "What should we bring?");
  if (!reply.includes("Boots, shin pads")) fail(`FAQ answer wrong: ${reply}`);
  ok("FAQ question answered from the coach's own answer (answer_faq tool)");
  reply = await chat(vp, "Any free times tomorrow?");
  if (!/Free times: .+\d\d:\d\d/.test(reply)) fail(`times reply wrong: ${reply}`);
  ok(`availability checked with real slot engine (${reply.slice(0, 60)}…)`);
  reply = await chat(vp, "Can I book a 1-to-1?");
  const signInLink = vp.locator("[role=dialog] a", { hasText: "Sign in and book" });
  await signInLink.waitFor();
  const href = await signInLink.getAttribute("href");
  if (!href.includes(`/${slug}/book/`) || !href.includes("start=")) fail(`bad sign-in link ${href}`);
  ok("signed-out visitor gets a 'Sign in and book' link with the time pre-chosen");
  await shot(vp, "p3-02-visitor-chat");
  const [conv1] = await db(`conversations?coach_id=eq.${coach.id}&select=id,visitor_token_hash,ip_hash`);
  if (!conv1.visitor_token_hash || conv1.visitor_token_hash.length !== 64) fail("token hash not stored");
  ok("conversation stored with a hashed token (no raw token in the database)");

  // Someone else can't read that conversation
  const stranger = await fetch(`${APP}/api/receptionist/${slug}?conversation_id=${conv1.id}`, { headers: { "x-chat-token": "wrong-token-wrong-token-wrong" } });
  if (stranger.status !== 404) fail("conversation readable with a wrong token");
  ok("a wrong chat token can't read the conversation");

  // ---------- Following the link: sign in, time pre-selected ----------
  const pathOnly = href.replace(/^https?:\/\/[^/]+/, "");
  await vp.goto(`${APP}${pathOnly}`);
  await vp.waitForURL(/\/login\?as=parent/);
  await signIn(vp, "parent", `p3-parent-${run}@example.com`, "Pat Parent", pathOnly);
  await vp.waitForURL(`**/${slug}/book/**`);
  const pressed = await vp.locator("fieldset button[aria-pressed=true]").count();
  if (pressed !== 1) fail("time from the chat link not pre-selected");
  ok("after sign-in the booking page opens with the chat's time already selected");

  // ---------- Signed-in parent books through the chat ----------
  await vp.goto(`${APP}/${slug}`);
  await vp.getByRole("button", { name: "Ask a question" }).click();
  reply = await chat(vp, "Please book a 1-to-1 for Mia");
  const pay = vp.locator("[role=dialog] a", { hasText: "Pay £30" });
  await pay.waitFor();
  if (!(await pay.getAttribute("href")).startsWith("https://checkout.stripe.com/")) fail("pay button not Stripe Checkout");
  const [aiBooking] = await db(`bookings?coach_id=eq.${coach.id}&source=eq.ai_receptionist&select=id,status,price_pence,stripe_checkout_session_id,player_id`);
  if (aiBooking?.status !== "pending" || aiBooking.price_pence !== 3000 || !aiBooking.stripe_checkout_session_id) fail(`AI booking wrong ${JSON.stringify(aiBooking)}`);
  const [mia] = await db(`players?id=eq.${aiBooking.player_id}&select=first_name,age_group,parental_consent_at`);
  if (mia.first_name !== "Mia" || !mia.parental_consent_at) fail("player not saved with consent");
  await shot(vp, "p3-03-parent-pay");
  ok("signed-in parent booked by chat: time held, player saved with consent, 'Pay £30' Stripe button shown");

  reply = await chat(vp, "Book the free taster for Mia too");
  if (!reply.includes("You're booked for")) fail(`free booking reply: ${reply}`);
  const [freeB] = await db(`bookings?coach_id=eq.${coach.id}&price_pence=eq.0&select=id,status`);
  if (freeB.status !== "confirmed") fail("free chat booking not confirmed");
  ok("free session booked and confirmed straight from the chat");

  // The taster starts within 24 hours, so the coach's default rule blocks online cancellation.
  reply = await chat(vp, "Actually please cancel it");
  let [afterCancel] = await db(`bookings?id=eq.${freeB.id}&select=status,cancelled_by`);
  if (afterCancel.status !== "confirmed" || !reply.includes("24 hours")) fail(`notice rule not applied: ${reply}`);
  ok("cancelling inside the coach's 24-hour rule is refused and offered to the coach instead");
  const [cs] = await db(`coaches?id=eq.${coach.id}&select=receptionist_settings`);
  await db(`coaches?id=eq.${coach.id}`, { method: "PATCH", body: JSON.stringify({ receptionist_settings: { ...cs.receptionist_settings, cancellation_notice_hours: 0 } }) });
  reply = await chat(vp, "Please cancel it");
  [afterCancel] = await db(`bookings?id=eq.${freeB.id}&select=status,cancelled_by`);
  if (afterCancel.status !== "cancelled" || afterCancel.cancelled_by !== "parent") fail(`cancel by chat failed: ${reply}`);
  ok("with the rule set to 'any time before', the parent cancels through the chat");

  // ---------- Hand-off to the coach ----------
  reply = await chat(vp, "Can I speak to the coach about trials?");
  if (!reply.includes("passed this to the coach")) fail(`handoff reply ${reply}`);
  const convs = await db(`conversations?coach_id=eq.${coach.id}&needs_handoff=eq.true&select=id,contact_email,handoff_reason`);
  if (convs.length !== 1 || convs[0].contact_email !== "sam.visitor@example.com") fail(`handoff not flagged ${JSON.stringify(convs)}`);
  ok("hand-off flags the conversation for the coach with the visitor's email");

  await cp.goto(`${APP}/coach/messages`);
  await cp.getByText("Needs you").first().waitFor();
  await shot(cp, "p3-04-coach-messages");
  await cp.getByText("Needs you").first().click();
  await cp.waitForURL(/\/coach\/messages\/.+/);
  await cp.fill('textarea[name="reply"]', "Hi! Trials are on Saturday 10am – just turn up with boots.");
  await cp.click('button:has-text("Send reply")');
  await cp.getByText("Sent").waitFor();
  await shot(cp, "p3-05-coach-conversation");
  const [handled] = await db(`conversations?id=eq.${convs[0].id}&select=needs_handoff`);
  if (handled.needs_handoff) fail("reply didn't clear the flag");
  ok("coach sees 'Needs you' in Messages, replies, and the flag clears");

  await vp.reload();
  await vp.getByRole("button", { name: "Ask a question" }).click();
  await vp.getByText("From the coach").waitFor();
  await vp.getByText("Trials are on Saturday").waitFor();
  await shot(vp, "p3-06-visitor-sees-reply");
  ok("visitor re-opens the chat and sees the coach's reply");

  // ---------- What the server sent to Claude ----------
  const reqs = readFileSync(process.env.MOCK_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const r = reqs[reqs.length - 1];
  const names = r.body.tools.map((t) => t.name).sort().join(",");
  if (r.body.model !== "claude-opus-5-5") fail(`model ${r.body.model}`);
  if (r.body.output_config?.effort !== "low") fail("effort not low");
  if (r.body.fallbacks !== "default" || !String(r.headers["anthropic-beta"]).includes("server-side-fallback-2026-07-01")) fail("refusal fallback not set");
  if (r.body.system[0].cache_control?.type !== "ephemeral" || r.body.system[1].cache_control) fail("cache breakpoint wrong");
  // Requests after the settings change (last 4 turns) must share the same cached instructions.
  const recent = reqs.slice(-5).map((x) => x.body.system[0].text);
  if (new Set(recent).size !== 1) fail("stable system prompt changed between requests (breaks caching)");
  if (!recent[0].includes("up to 0 hours before")) fail("settings change not reflected in the instructions");
  if (names !== "answer_faq,cancel_booking,check_availability,create_booking,get_services,hand_off_to_coach,list_my_bookings,list_my_players,reschedule_booking") fail(`tools ${names}`);
  ok(`requests to Claude: ${r.body.model}, effort low, refusal fallback on, cached system prompt stable, 9 tools`);

  // Parent cannot open coach messages
  await vp.goto(`${APP}/coach/messages`);
  if (!vp.url().includes("/parent")) fail("parent reached coach messages");
  ok("parent is kept out of the coach's Messages");
  console.log("ALL PHASE 3 CHECKS PASSED");
} finally {
  await browser.close();
  for (const id of users.filter(Boolean)) await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: H });
  if (stripeAccount) await stripe.v2.core.accounts.close(stripeAccount, { applied_configurations: ["merchant"] }).catch(() => undefined);
  console.log(`cleanup - removed ${users.length} test users${stripeAccount ? " and the test Stripe account" : ""}`);
}
