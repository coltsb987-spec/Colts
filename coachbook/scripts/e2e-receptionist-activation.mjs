// The receptionist switches on by itself once the essentials are in place, and can be paused.
// LOCAL Supabase + `npm run dev` with ANTHROPIC_API_KEY set (any value: no AI calls are made here).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const APP = process.env.APP_URL ?? "http://localhost:3000";
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
const SHOTS = process.argv[2];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const H = { apikey: KEY, "Content-Type": "application/json", ...(KEY === "proxy-injected" ? {} : { Authorization: `Bearer ${KEY}` }) };
const run = Date.now().toString(36);
const ok = (m) => console.log(`ok - ${m}`);
const fail = (m) => { throw new Error(`FAIL: ${m}`); };
let userId = null;
const browser = await chromium.launch(process.env.E2E_BROWSER_PROXY ? { proxy: { server: process.env.E2E_BROWSER_PROXY } } : {});
try {
  const link = await (await fetch(`${SB}/auth/v1/admin/generate_link`, { method: "POST", headers: H, body: JSON.stringify({ type: "magiclink", email: `delivered+act-${run}@resend.dev`, data: { role: "coach", full_name: "Act Test" } }) })).json();
  userId = link.id ?? link.user?.id;
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(`${APP}/auth/confirm?next=/coach/profile&token_hash=${link.hashed_token ?? link.properties?.hashed_token}&type=email`);
  await page.waitForURL(`${APP}/coach/profile`);
  await page.fill('input[name="business_name"]', `Act Football ${run}`);
  await page.click('button:has-text("Save and continue")');
  await page.waitForURL(/\/coach\/services/);
  const slug = `act-football-${run}`;
  await page.goto(`${APP}/coach`);
  await page.getByText("Switch on your AI receptionist").waitFor();
  ok("new coach's checklist includes 'Switch on your AI receptionist'");

  // 1. Settings first: not live yet, says what's missing
  await page.goto(`${APP}/coach/receptionist`);
  await page.getByText("Your receptionist switches on by itself once these are done").waitFor();
  await page.click('button:has-text("Save settings")');
  await page.getByText("will switch on automatically once you've added at least one session and your weekly hours").waitFor();
  ok("saving settings without sessions/hours explains what's still needed");

  // 2. A session: still waiting for hours
  await page.goto(`${APP}/coach/services`);
  await page.fill('input[name="name"] >> nth=-1', "1-to-1 session");
  await page.fill('input[name="price"] >> nth=-1', "30");
  await page.click('button:has-text("Add session")');
  await page.getByText("Added “1-to-1 session”").waitFor();
  if (await page.getByText("Your receptionist is now live").count()) fail("went live without hours");

  // 3. Hours: goes live, with the message, on the page where they pressed Save
  await page.goto(`${APP}/coach/availability`);
  await page.selectOption('select[name="weekday"]', "6");
  await page.click('button:has-text("Add hours")');
  await page.getByText("Your receptionist is now live").waitFor();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/act-01-live.png`, fullPage: true });
  ok("adding the last essential (hours) switches it on with 'Your receptionist is now live'");

  // Publish and check the chat button appears
  await page.goto(`${APP}/coach`);
  await page.click('button:has-text("Publish page")');
  await page.getByRole("button", { name: "Hide page" }).waitFor();
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`${APP}/${slug}`);
  await visitor.getByRole("button", { name: "Ask a question" }).waitFor();
  ok("chat button shows on the published page");
  if (process.env.LIVE_CHAT) {
    // Real Claude: the freshly switched-on receptionist answers from the coach's own sessions.
    await visitor.getByRole("button", { name: "Ask a question" }).click();
    await visitor.fill("#chat-input", "Hi! What sessions do you offer and how much are they?");
    await visitor.click("[role=dialog] button:has-text('Send')");
    await visitor.waitForFunction(() => document.querySelectorAll("[role=dialog] .justify-start").length >= 2 && !document.querySelector("[aria-label=Typing]"), null, { timeout: 60000 });
    const reply = (await visitor.locator("[role=dialog] .justify-start").last().innerText()).trim();
    console.log(`  (real reply) ${reply.replace(/\s+/g, " ").slice(0, 220)}`);
    if (!/1-to-1/i.test(reply) || !/£?30/.test(reply)) fail("real receptionist didn't describe the coach's session");
    if (reply.includes("**")) fail("raw Markdown asterisks shown in the chat");
    ok("the newly live receptionist answers a real question with the coach's session and price");
    await visitor.getByRole("button", { name: "Close chat" }).click();
  }

  // 4. Pause
  await page.goto(`${APP}/coach/receptionist`);
  await page.getByText("Your receptionist is live on your booking page").waitFor();
  await page.getByRole("switch").check();
  await page.click('button:has-text("Save settings")');
  await page.getByText("Saved – your receptionist is paused").waitFor();
  await visitor.reload();
  await visitor.waitForTimeout(500);
  if (await visitor.getByRole("button", { name: "Ask a question" }).count()) fail("chat still shown when paused");
  // Adding more sessions must NOT switch a paused receptionist back on
  await page.goto(`${APP}/coach/services`);
  await page.fill('input[name="name"] >> nth=-1', "Group session");
  await page.fill('input[name="price"] >> nth=-1', "10");
  await page.click('button:has-text("Add session")');
  await page.getByText("Added “Group session”").waitFor();
  const [c] = await (await fetch(`${SB}/rest/v1/coaches?profile_id=eq.${userId}&select=receptionist_settings`, { headers: H })).json();
  if (c.receptionist_settings.enabled || !c.receptionist_settings.paused) fail("paused receptionist switched itself back on");
  await page.goto(`${APP}/coach/receptionist`);
  await page.getByText("Your receptionist is paused. Untick").waitFor();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/act-02-paused.png`, fullPage: true });
  ok("pausing hides the chat, and it stays paused when the coach changes other things");

  // 5. Resume
  await page.getByRole("switch").uncheck();
  await page.click('button:has-text("Save settings")');
  await page.getByText("Your receptionist is now live").waitFor();
  await visitor.reload();
  await visitor.getByRole("button", { name: "Ask a question" }).waitFor();
  ok("unpausing switches it straight back on with the 'now live' message");
  console.log("ALL ACTIVATION CHECKS PASSED");
} finally {
  await browser.close();
  if (userId) await fetch(`${SB}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: H });
  console.log("cleanup - removed the test user");
}
