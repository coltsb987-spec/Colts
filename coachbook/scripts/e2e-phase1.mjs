// End-to-end check of Phase 1 against LOCAL Supabase (npx supabase start) and `npm run dev`.
// Uses Mailpit (local test inbox) to click the magic links. Run: node scripts/e2e-phase1.mjs [screenshot-dir]
import { createRequire } from "node:module";
// Uses the project copy of playwright if installed, otherwise a globally installed one.
const { chromium } = createRequire(import.meta.url)("playwright");
import { mkdirSync } from "node:fs";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const SHOTS = process.argv[2];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);
const coachEmail = `coach-${run}@example.com`;
const parentEmail = `parent-${run}@example.com`;
const slug = `test-coach-${run}`;

const ok = (msg) => console.log(`ok - ${msg}`);
const fail = (msg) => { throw new Error(`FAIL: ${msg}`); };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

async function magicLink(email) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const { messages } = await res.json();
    if (messages?.length) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json();
      const href = msg.HTML.match(/href="([^"]*token_hash[^"]*)"/)?.[1];
      if (href) return href.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`no magic link email for ${email}`);
}

async function signIn(page, as, email, name) {
  await page.goto(`${APP}/login?as=${as}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="full_name"]', name);
  await page.click('button[type="submit"]');
  await page.getByText("we've sent you a sign-in link").waitFor();
  await page.goto(await magicLink(email));
  await page.waitForURL(`${APP}/${as}**`);
}

const browser = await chromium.launch();
try {
  // ---------- Coach ----------
  const coachCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await coachCtx.newPage();
  await page.goto(APP);
  await shot(page, "01-landing");
  await page.goto(`${APP}/coach`);
  if (!page.url().includes("/login?as=coach")) fail("signed-out visitor not sent to login");
  ok("signed-out visitor is redirected to coach login");
  await shot(page, "02-login");

  await signIn(page, "coach", coachEmail, "Sam Patel");
  ok("coach signed in with magic link");
  await shot(page, "03-coach-welcome");

  await page.goto(`${APP}/coach/profile`);
  await page.fill('input[name="business_name"]', `Sam Patel Football ${run}`);
  await page.fill('input[name="slug"]', "login");
  await page.click('button[type="submit"]');
  await page.getByText("That link is reserved").waitFor();
  ok("reserved booking link rejected");
  await page.fill('input[name="slug"]', slug);
  await page.fill('textarea[name="bio"]', "Grassroots coach helping 6–14 year olds build confidence on the ball. Sessions focus on first touch, 1v1 skills and finishing.");
  await page.fill('textarea[name="qualifications"]', "UEFA C Licence\nFA Emergency Aid");
  await page.fill('input[name="postcode"]', "m14 6hr");
  await page.check('input[name="dbs_checked"]');
  await page.fill('input[name="dbs_date"]', "2025-03-01");
  // generate a simple test photo
  const photoPage = await coachCtx.newPage();
  await photoPage.setContent('<div style="width:300px;height:300px;background:linear-gradient(135deg,#D4FF3A,#222622)"></div>');
  const photo = await photoPage.locator("div").screenshot({ type: "png" });
  await photoPage.close();
  await page.setInputFiles('input[name="photo"]', { name: "me.png", mimeType: "image/png", buffer: photo });
  await shot(page, "04-profile-form");
  await page.click('button[type="submit"]');
  await page.waitForURL(`${APP}/coach/services**`);
  ok("profile saved with photo, moved to services");

  // services
  await page.fill('input[name="name"]', "1-to-1 technical session");
  await page.selectOption('select[name="duration_minutes"]', "60");
  await page.fill('input[name="price"]', "35");
  await page.fill('input[name="location"]', "Platt Fields 3G, Manchester");
  await page.click('button:has-text("Add session")');
  await page.getByText("Added “1-to-1 technical session”").waitFor();
  await page.selectOption('select[name="type"] >> nth=-1', "group");
  await page.fill('input[name="name"] >> nth=-1', "Small group finishing");
  await page.fill('input[name="price"] >> nth=-1', "12.50");
  await page.fill('input[name="max_participants"] >> nth=-1', "6");
  await page.click('button:has-text("Add session")');
  await page.getByText("Added “Small group finishing”").waitFor();
  await page.reload();
  if ((await page.getByText("£12.50 per player · up to 6").count()) !== 1) fail("group service not listed");
  ok("two services added");
  await shot(page, "05-services");

  // try publishing too early
  await page.goto(`${APP}/coach`);
  await page.click('button:has-text("Publish page")');
  await page.getByText("Add your weekly availability first").waitFor();
  ok("cannot publish without availability");

  // availability
  await page.goto(`${APP}/coach/availability`);
  for (const [day, name, from, to] of [["1", "Monday", "16:00", "19:00"], ["3", "Wednesday", "16:00", "19:00"], ["6", "Saturday", "09:00", "13:00"]]) {
    await page.selectOption('select[name="weekday"]', day);
    await page.fill('input[name="start_time"] >> nth=0', from);
    await page.fill('input[name="end_time"] >> nth=0', to);
    await page.click('button:has-text("Add hours")');
    await page.getByText(`Added ${name} ${from}–${to}.`).waitFor();
  }
  await page.selectOption('select[name="weekday"]', "1");
  await page.fill('input[name="start_time"] >> nth=0', "18:00");
  await page.fill('input[name="end_time"] >> nth=0', "20:00");
  await page.click('button:has-text("Add hours")');
  await page.getByText("overlap").waitFor();
  ok("weekly hours added; overlapping hours rejected");
  await page.fill('input[name="date"]', "2026-12-25");
  await page.fill('input[name="note"]', "Christmas Day");
  await page.click('button:has-text("Save change")');
  await page.getByText("Time blocked off.").waitFor();
  await page.reload();
  ok("holiday blocked");
  await shot(page, "06-availability");

  // publish
  await page.goto(`${APP}/coach`);
  await page.click('button:has-text("Publish page")');
  await page.getByRole("button", { name: "Hide page" }).waitFor();
  await page.getByText("Live", { exact: true }).waitFor();
  await page.reload();
  ok("booking page published");
  await shot(page, "07-dashboard");

  // ---------- Public page (signed out) ----------
  const anon = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const pub = await anon.newPage();
  const resp = await pub.goto(`${APP}/${slug}`);
  if (resp.status() !== 200) fail(`public page status ${resp.status()}`);
  await pub.getByText("Small group finishing").waitFor();
  if ((await pub.getByText("Based in M14").count()) !== 1) fail("postcode area not shown");
  if ((await pub.getByText("6HR").count()) !== 0) fail("full postcode leaked");
  await pub.getByText("DBS checked").waitFor();
  await pub.getByText("09:00–13:00").waitFor();
  ok("public booking page shows services, area only (not full postcode), DBS");
  await shot(pub, "08-public-page-mobile");
  const desktop = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await desktop.goto(`${APP}/${slug}`);
  await shot(desktop, "09-public-page-desktop");
  if ((await pub.goto(`${APP}/no-such-coach-xyz`)).status() !== 404) fail("unknown slug not 404");
  ok("unknown coach link gives 404");

  // ---------- Parent ----------
  const parentCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pp = await parentCtx.newPage();
  await signIn(pp, "parent", parentEmail, "Alex Jones");
  ok("parent signed in with magic link");
  await pp.fill('input[name="first_name"]', "Leo");
  await pp.selectOption('select[name="age_group"]', "U10");
  await pp.click('button:has-text("Add player")');
  if ((await pp.getByText("Leo added.").count()) !== 0) fail("player added without consent");
  ok("player cannot be added without consent (browser blocks submit)");
  await pp.check('input[name="consent"]');
  await pp.click('button:has-text("Add player")');
  await pp.getByText("Leo added.").waitFor();
  await pp.reload();
  ok("parent added a player with consent");
  await shot(pp, "10-parent");
  await pp.goto(`${APP}/coach`);
  if (!pp.url().includes("/parent?wrong_area=coach")) fail(`parent reached coach area: ${pp.url()}`);
  ok("parent is kept out of the coach area");

  // sign out
  await page.click('button:has-text("Sign out")');
  await page.waitForURL(`${APP}/`);
  await page.goto(`${APP}/coach`);
  if (!page.url().includes("/login")) fail("still signed in after sign out");
  ok("coach signed out");
  console.log("ALL E2E CHECKS PASSED");
} finally {
  await browser.close();
}
