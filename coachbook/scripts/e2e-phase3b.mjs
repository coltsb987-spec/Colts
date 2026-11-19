// Phase 3b end-to-end test: "Fill my profile for me". Local stack + mock Claude (see e2e-phase3.mjs).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP_URL ?? "http://localhost:3000";
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY;
const SHOTS = process.argv[2];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);
const users = [];
const ok = (m) => console.log(`ok - ${m}`);
const fail = (m) => { throw new Error(`FAIL: ${m}`); };
const H = { apikey: SB_KEY, "Content-Type": "application/json", ...(SB_KEY === "proxy-injected" ? {} : { Authorization: `Bearer ${SB_KEY}` }) };
const db = async (path) => (await fetch(`${SB}/rest/v1/${path}`, { headers: H })).json();

const browser = await chromium.launch(process.env.E2E_BROWSER_PROXY ? { proxy: { server: process.env.E2E_BROWSER_PROXY } } : {});
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const res = await fetch(`${SB}/auth/v1/admin/generate_link`, { method: "POST", headers: H, body: JSON.stringify({ type: "magiclink", email: `p3b-${run}@example.com`, data: { role: "coach", full_name: "Sam Test" } }) });
  const link = await res.json();
  const userId = link.id ?? link.user?.id;
  users.push(userId);
  await page.goto(`${APP}/auth/confirm?next=/coach&token_hash=${link.hashed_token ?? link.properties?.hashed_token}&type=email`);
  await page.waitForURL(`${APP}/coach`);
  await page.getByRole("link", { name: "Fill my profile for me" }).click();
  await page.waitForURL(`${APP}/coach/setup`);
  ok("new coach is offered 'Fill my profile for me' on their dashboard");

  // Instagram link only: explained in plain words, no draft used.
  await page.getByLabel("Link 1").fill("https://www.instagram.com/some.coach/");
  await page.click('button:has-text("Fill my profile for me")');
  await page.getByText("Instagram didn't let us read that page").waitFor({ timeout: 30000 });
  await page.getByText("We couldn't read your link").waitFor();
  const meta = async () => (await (await fetch(`${SB}/auth/v1/admin/users/${userId}`, { headers: H })).json()).app_metadata?.setup_drafts?.count ?? 0;
  if ((await meta()) !== 0) fail("an unreadable link used up a draft");
  ok("an Instagram link that can't be read is explained in plain words, offering text or screenshots, and uses no draft");

  // Text + a private address + a screenshot
  await page.fill("textarea", "I'm Sam, UEFA C coach in Bolton, DBS checked. 1-to-1s for ages 7-14 on Saturday mornings 9-12 at Moss Bank 3G.");
  await page.getByLabel("Link 1").fill("http://127.0.0.1:3000/");
  const shotPage = await page.context().newPage();
  await shotPage.setContent('<div style="width:600px;height:400px;font:24px sans-serif;padding:20px">@sam.coaching · 1-to-1 football coaching · Bolton</div>');
  const png = await shotPage.locator("div").screenshot({ type: "png" });
  await shotPage.close();
  await page.getByLabel("Add screenshots").setInputFiles({ name: "insta.png", mimeType: "image/png", buffer: png });
  await page.getByAltText("Screenshot 1").waitFor();
  await page.click('button:has-text("Fill my profile for me")');
  await page.getByText("A few quick questions").waitFor({ timeout: 60000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3b-01-questions.png`, fullPage: true });
  if (!(await page.getByRole("button", { name: "Save what's ticked" }).isDisabled())) fail("could save a session with no price");
  await page.getByText("We couldn't open that link").waitFor();
  await page.getByText("Read 1 screenshot(s).").waitFor();
  if ((await page.getByRole("textbox", { name: "Postcode or area (e.g. M14)" }).inputValue()) !== "BL1") fail("postcode area not drafted");
  ok("draft appears from text + screenshot; a private/internal link is refused; postcode area BL1 drafted");
  ok("it asks for the missing price and won't save a session without one");

  await page.getByLabel("How much is a 1-to-1 session?").fill("£30 an hour");
  await page.click('button:has-text("Update my draft")');
  await page.waitForFunction(() => !document.body.innerText.includes("A few quick questions") && document.body.innerText.includes("Sessions & prices"), null, { timeout: 60000 });
  if ((await page.getByLabel("Price").inputValue()) !== "30") fail("price not filled from the answer");
  await page.getByText("we never tick it for you").waitFor();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3b-02-review.png`, fullPage: true });
  ok("answering the question updates the draft (price £30); DBS is flagged for the coach to tick themselves");

  // Claude's suggested profile picture is pre-selected and framed
  if ((await page.getByRole("radio", { name: "Use screenshot 1 for my photo" }).getAttribute("aria-checked")) !== "true") fail("found photo not pre-selected");
  await page.getByText("We've framed the profile picture we found").waitFor();
  if (Number(await page.getByLabel("Zoom").inputValue()) <= 1) fail("found photo not zoomed in");
  ok("the profile picture Claude found is pre-selected and the crop is zoomed onto it");
  // ...and the coach can still adjust it: zoom and drag
  const crop = page.getByRole("img", { name: /Photo crop area/ });
  await crop.waitFor();
  await page.getByLabel("Zoom").fill("2.5");
  const box = await crop.boundingBox();
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 140, { steps: 5 });
  await page.mouse.up();
  await crop.focus();
  await page.keyboard.press("ArrowLeft");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3b-02b-photo.png`, fullPage: true });

  // Untick the postcode, save the rest
  await page.getByLabel("Use Postcode or area (e.g. M14)").uncheck();
  await page.click(`button:has-text("Save what's ticked")`);
  await page.getByRole("heading", { name: "Saved" }).waitFor({ timeout: 30000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3b-03-saved.png`, fullPage: true });
  const [coach] = await db(`coaches?profile_id=eq.${userId}&select=id,slug,business_name,postcode,dbs_checked,qualifications,receptionist_settings`);
  if (!coach || coach.slug !== "sam-bolton-football" || coach.postcode !== null || coach.dbs_checked) fail(`coach wrong ${JSON.stringify(coach)}`);
  const [withPhoto] = await db(`coaches?id=eq.${coach.id}&select=photo_url`);
  if (!withPhoto.photo_url?.includes("/coach-photos/")) fail("profile photo not saved");
  const size = await page.evaluate(async (src) => {
    const im = new Image();
    im.src = src;
    await im.decode();
    return [im.naturalWidth, im.naturalHeight];
  }, withPhoto.photo_url);
  if (size[0] !== 600 || size[1] !== 600) fail(`photo size ${size}`);
  ok("a cropped 600×600 profile photo from the screenshot is saved");
  await page.getByText("You've got everything needed to go live").waitFor();
  await page.getByRole("button", { name: "Publish my page" }).click();
  await page.waitForFunction(() => true);
  for (let i = 0; i < 20; i++) {
    const [c] = await db(`coaches?id=eq.${coach.id}&select=published`);
    if (c.published) break;
    await page.waitForTimeout(500);
    if (i === 19) fail("publish didn't work");
  }
  ok("with a name, one session and hours, the coach can publish straight from the setup screen");
  const pub = await (await browser.newContext()).newPage();
  await pub.goto(`${APP}/${coach.slug}`);
  const shown = await pub.locator("main img").first().evaluate(async (im) => { if (!im.complete) await new Promise((r) => (im.onload = im.onerror = r)); return im.naturalWidth > 0; });
  if (!shown) fail("photo not shown on public page");
  ok("the photo shows on the coach's public page");
  const services = await db(`services?coach_id=eq.${coach.id}&select=name,price_pence,duration_minutes`);
  const rules = await db(`availability_rules?coach_id=eq.${coach.id}&select=weekday,start_time,end_time`);
  if (services.length !== 1 || services[0].price_pence !== 3000) fail(`services wrong ${JSON.stringify(services)}`);
  if (rules.length !== 1 || rules[0].weekday !== 6 || rules[0].start_time !== "09:00:00") fail(`hours wrong ${JSON.stringify(rules)}`);
  if (coach.receptionist_settings.faqs?.length !== 1) fail("FAQ not saved");
  ok(`saved: page /${coach.slug}, 1 session at £30, Saturday 09:00–12:00, 1 FAQ; unticked postcode not saved; DBS left unticked`);

  // Running it again adds sessions but skips overlapping hours
  await page.goto(`${APP}/coach/setup`);
  await page.fill("textarea", "Same as before. £30 for 1-to-1s.");
  await page.click('button:has-text("Fill my profile for me")');
  await page.getByText("Sessions & prices").waitFor({ timeout: 60000 });
  await page.getByLabel("Use session 1-to-1 session").uncheck();
  await page.click(`button:has-text("Save what's ticked")`);
  await page.getByText("overlap hours you already have").waitFor({ timeout: 30000 });
  ok("running it again for an existing coach skips hours that overlap what's already saved");
  console.log("ALL PHASE 3B CHECKS PASSED");
} finally {
  await browser.close();
  for (const id of users.filter(Boolean)) await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: H });
  console.log(`cleanup - removed ${users.length} test user(s)`);
}
