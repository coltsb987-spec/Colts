// Live check of password sign-up/sign-in/reset on a deployed site.
// Emails go to Resend's test inbox (delivered+…@resend.dev), so clicking the emailed links is
// stood in for with the admin API. SUPABASE_SECRET_KEY may be "proxy-injected".
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const APP = process.env.APP_URL, SB = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
const H = { apikey: KEY, "Content-Type": "application/json", ...(KEY === "proxy-injected" ? {} : { Authorization: `Bearer ${KEY}` }) };
const run = Date.now().toString(36);
const email = `delivered+pw-${run}@resend.dev`;
let userId = null;
const ok = (m) => console.log(`ok - ${m}`);
const fail = (m) => { throw new Error(`FAIL: ${m}`); };
const browser = await chromium.launch(process.env.E2E_BROWSER_PROXY ? { proxy: { server: process.env.E2E_BROWSER_PROXY } } : {});
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${APP}/login?as=coach&method=password`);
  await page.getByRole("link", { name: "Create an account with a password" }).click();
  await page.fill('input[name="full_name"]', "Live Password Test");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password123");
  await page.fill('input[name="confirm"]', "Password123");
  await page.click('button:has-text("Create account")');
  await page.getByText("too common").waitFor();
  await page.fill('input[name="password"]', "lantern-offside-pebble");
  await page.fill('input[name="confirm"]', "lantern-offside-pebble");
  await page.click('button:has-text("Create account")');
  await page.getByText("tap the link to confirm your account").waitFor({ timeout: 30000 });
  const users = (await (await fetch(`${SB}/auth/v1/admin/users?per_page=200`, { headers: H })).json()).users;
  const u = users.find((x) => x.email === email);
  if (!u || u.email_confirmed_at) fail("account not created, or confirmed without the email");
  userId = u.id;
  ok("live sign-up: weak password refused, account created, waiting for email confirmation (confirmation email sent via Resend)");

  await page.goto(`${APP}/login?as=coach&method=password`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "lantern-offside-pebble");
  await page.click('button:has-text("Sign in")');
  await page.getByText("Please confirm your email first").waitFor();
  ok("can't sign in before confirming");

  await fetch(`${SB}/auth/v1/admin/users/${userId}`, { method: "PUT", headers: H, body: JSON.stringify({ email_confirm: true }) });
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(`${APP}/coach**`, { timeout: 30000 });
  ok("after confirming, password sign-in opens the coach dashboard");

  await page.goto(`${APP}/forgot-password?as=coach`);
  await page.fill('input[name="email"]', email);
  await page.click('button:has-text("Email me a reset link")');
  await page.getByText("we've emailed a link to choose a new password").waitFor({ timeout: 30000 });
  ok("forgot password: reset email requested (sent via Resend)");

  const link = await (await fetch(`${SB}/auth/v1/admin/generate_link`, { method: "POST", headers: H, body: JSON.stringify({ type: "recovery", email }) })).json();
  const other = await (await browser.newContext()).newPage();
  await other.goto(`${APP}/auth/confirm?next=/reset-password&token_hash=${link.hashed_token ?? link.properties?.hashed_token}&type=recovery`);
  await other.waitForURL(`${APP}/reset-password`);
  await other.fill('input[name="password"]', "meadow-volley-compass");
  await other.fill('input[name="confirm"]', "meadow-volley-compass");
  await other.click('button:has-text("Save password")');
  await other.getByText("Your password has been updated").waitFor({ timeout: 30000 });
  ok("reset link sets a new password and signs in");

  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto(`${APP}/login?as=coach&method=password`);
  await fresh.fill('input[name="email"]', email);
  await fresh.fill('input[name="password"]', "lantern-offside-pebble");
  await fresh.click('button:has-text("Sign in")');
  await fresh.getByText("That email and password don't match").waitFor();
  await fresh.fill('input[name="password"]', "meadow-volley-compass");
  await fresh.click('button:has-text("Sign in")');
  await fresh.waitForURL(`${APP}/coach**`, { timeout: 30000 });
  ok("old password refused, new password works");

  const linkTab = await (await browser.newContext()).newPage();
  await linkTab.goto(`${APP}/login?as=coach`);
  await linkTab.getByRole("button", { name: "Email me a sign-in link" }).waitFor();
  ok("'Email me a link' is still the default option");
  console.log("ALL LIVE PASSWORD CHECKS OK");
} finally {
  await browser.close();
  if (userId) await fetch(`${SB}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: H });
  console.log("cleanup - removed the test user");
}
