// Password sign-in, sign-up and reset – end-to-end against LOCAL Supabase (+ Mailpit inbox) and `npm run dev`.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP_URL ?? "http://localhost:3000";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY;
const SHOTS = process.argv[2];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);
const ok = (m) => console.log(`ok - ${m}`);
const fail = (m) => { throw new Error(`FAIL: ${m}`); };
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

async function latestLink(email, subjectWord) {
  for (let i = 0; i < 40; i++) {
    const { messages } = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email} subject:"${subjectWord}"`)}`)).json();
    if (messages?.length) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json();
      const href = msg.HTML.match(/href="([^"]*token_hash[^"]*)"/)?.[1];
      if (href) return href.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`no "${subjectWord}" email for ${email}`);
}
const userByEmail = async (email) => (await (await fetch(`${SB}/auth/v1/admin/users?per_page=200`, { headers: H })).json()).users.find((u) => u.email === email);

const browser = await chromium.launch();
const created = [];
try {
  const email = `pw-coach-${run}@example.com`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  // ----- Tabs -----
  await page.goto(`${APP}/login?as=coach`);
  await page.getByRole("tab", { name: "Email me a link" }).waitFor();
  if ((await page.getByRole("tab", { name: "Email me a link" }).getAttribute("aria-selected")) !== "true") fail("link tab not default");
  await page.getByRole("tab", { name: "Sign in with password" }).click();
  await page.locator('input[name="password"]').waitFor();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pw-01-signin.png`, fullPage: true });
  ok("sign-in page offers 'Email me a link' (default) and 'Sign in with password'");

  // ----- Sign up -----
  await page.getByRole("link", { name: "Create an account with a password" }).click();
  await page.waitForURL(/\/signup\?as=coach/);
  await page.fill('input[name="full_name"]', "Pat Password");
  await page.fill('input[name="email"]', email);
  for (const [pw, msg] of [["Football123!", "too common"], [`pw-coach-${run}xx`, "email address"]]) {
    await page.fill('input[name="password"]', pw);
    await page.fill('input[name="confirm"]', pw);
    await page.click('button:has-text("Create account")');
    await page.getByText(msg).waitFor();
  }
  await page.fill('input[name="password"]', "kettle-goalpost-orbit");
  await page.fill('input[name="confirm"]', "kettle-goalpost-orbitt");
  await page.click('button:has-text("Create account")');
  await page.getByText("don't match").waitFor();
  ok("weak, common, email-based and mismatched passwords are refused with plain advice");
  await page.fill('input[name="confirm"]', "kettle-goalpost-orbit");
  await page.click('button:has-text("Create account")');
  await page.getByText("tap the link to confirm your account").waitFor();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pw-02-signup.png`, fullPage: true });
  const u = await userByEmail(email);
  created.push(u.id);
  if (u.email_confirmed_at) fail("confirmed without clicking the link");

  // Signing in before confirming
  await page.goto(`${APP}/login?as=coach&method=password`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "kettle-goalpost-orbit");
  await page.click('button:has-text("Sign in")');
  await page.getByText("Please confirm your email first").waitFor();
  ok("new account must confirm its email before signing in");

  await page.goto(await latestLink(email, "sign-in link"));
  await page.waitForURL(`${APP}/coach**`);
  ok("confirmation link signs the coach in to their dashboard");

  // ----- Sign out, wrong password, right password -----
  await page.click('button:has-text("Sign out")');
  await page.waitForURL(`${APP}/`);
  await page.goto(`${APP}/login?as=coach&method=password`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "wrong-password-here");
  await page.click('button:has-text("Sign in")');
  await page.getByText("That email and password don't match").waitFor();
  await page.fill('input[name="email"]', `nobody-${run}@example.com`);
  await page.click('button:has-text("Sign in")');
  await page.getByText("That email and password don't match").waitFor();
  ok("wrong password and unknown email get the same message (no account fishing)");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "kettle-goalpost-orbit");
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(`${APP}/coach**`);
  ok("signs in with the password");

  // ----- Change password from the dashboard -----
  await page.getByRole("link", { name: "Password" }).click();
  await page.waitForURL(`${APP}/reset-password`);
  await page.fill('input[name="password"]', "kettle-goalpost-orbit");
  await page.fill('input[name="confirm"]', "kettle-goalpost-orbit");
  await page.click('button:has-text("Save password")');
  await page.getByText("That's your current password").waitFor();
  ok("dashboard 'Password' link lets a signed-in coach change it (same password refused)");
  await page.click('button:has-text("Sign out")').catch(() => undefined);
  await ctx.clearCookies();

  // ----- Forgot password -----
  await page.goto(`${APP}/login?as=coach&method=password`);
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.waitForURL(/\/forgot-password/);
  await page.fill('input[name="email"]', email);
  await page.click('button:has-text("Email me a reset link")');
  await page.getByText("we've emailed a link to choose a new password").waitFor();
  await page.fill('input[name="email"]', `nobody-${run}@example.com`);
  await page.click('button:has-text("Email me a reset link")');
  await page.getByText(`If there's an account for nobody-${run}@example.com`).waitFor();
  ok("reset request gives the same answer for real and unknown emails");

  // Open the reset link in a DIFFERENT browser (works across devices)
  const other = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await other.goto(await latestLink(email, "Reset your CoachBook UK password"));
  await other.waitForURL(`${APP}/reset-password`);
  await other.fill('input[name="password"]', "short");
  await other.fill('input[name="confirm"]', "short");
  await other.evaluate(() => document.querySelectorAll("input").forEach((i) => i.removeAttribute("minlength")));
  await other.click('button:has-text("Save password")');
  await other.getByText("at least 10").waitFor();
  await other.fill('input[name="password"]', "harbour-penguin-tactics");
  await other.fill('input[name="confirm"]', "harbour-penguin-tactics");
  await other.click('button:has-text("Save password")');
  await other.waitForURL(/\/coach\?password=updated/);
  await other.getByText("Your password has been updated").waitFor();
  if (SHOTS) await other.screenshot({ path: `${SHOTS}/pw-03-updated.png`, fullPage: true });
  ok("reset link opened on another device sets a new password (server re-checks strength)");

  // Old password fails, new works
  await page.goto(`${APP}/login?as=coach&method=password`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "kettle-goalpost-orbit");
  await page.click('button:has-text("Sign in")');
  await page.getByText("That email and password don't match").waitFor();
  await page.fill('input[name="password"]', "harbour-penguin-tactics");
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(`${APP}/coach**`);
  ok("old password no longer works; the new one does");

  // Expired / reused reset link
  const stale = await (await browser.newContext()).newPage();
  await stale.goto(`${APP}/reset-password`);
  await stale.getByText("That link has expired").waitFor();
  ok("opening the reset page without a valid link explains it has expired");

  // ----- Parent sign-up keeps them on their booking journey -----
  const pemail = `pw-parent-${run}@example.com`;
  const pp = await (await browser.newContext()).newPage();
  await pp.goto(`${APP}/signup?as=parent&next=${encodeURIComponent("/parent/bookings")}`);
  await pp.fill('input[name="full_name"]', "Robin Parent");
  await pp.fill('input[name="email"]', pemail);
  await pp.fill('input[name="password"]', "orange-crossbar-meadow");
  await pp.fill('input[name="confirm"]', "orange-crossbar-meadow");
  await pp.click('button:has-text("Create account")');
  await pp.getByText("tap the link to confirm").waitFor();
  created.push((await userByEmail(pemail)).id);
  await pp.goto(await latestLink(pemail, "sign-in link"));
  await pp.waitForURL(`${APP}/parent/bookings`);
  const [prof] = await (await fetch(`${SB}/rest/v1/profiles?id=eq.${created[1]}&select=role,full_name`, { headers: H })).json();
  if (prof.role !== "parent" || prof.full_name !== "Robin Parent") fail(`parent profile wrong ${JSON.stringify(prof)}`);
  ok("parent signs up with a password, confirms, and lands where they were heading, as a parent");

  // A parent can't use the coach password form to get into the coach area
  const cross = await (await browser.newContext()).newPage();
  await cross.goto(`${APP}/login?as=coach&method=password&next=/coach`);
  await cross.fill('input[name="email"]', pemail);
  await cross.fill('input[name="password"]', "orange-crossbar-meadow");
  await cross.click('button:has-text("Sign in")');
  await cross.waitForURL(`${APP}/parent**`);
  ok("a parent signing in on the coach page is sent to the parent area");
  console.log("ALL PASSWORD CHECKS PASSED");
} finally {
  await browser.close();
  for (const id of created) await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: H });
  console.log(`cleanup - removed ${created.length} test users`);
}
