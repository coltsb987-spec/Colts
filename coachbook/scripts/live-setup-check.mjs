// Live check of "Fill my profile for me" against a deployed site with the REAL Claude API.
//   APP_URL=… NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/live-setup-check.mjs [report.md] [shots-dir]
// SUPABASE_SECRET_KEY may be "proxy-injected" when a network proxy adds the key.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP_URL;
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY;
const [REPORT, SHOTS] = process.argv.slice(2);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);
const users = [];
const lines = [`# Live "Fill my profile for me" test – ${new Date().toISOString()}\n`];
let failures = 0;
const H = { apikey: SB_KEY, "Content-Type": "application/json", ...(SB_KEY === "proxy-injected" ? {} : { Authorization: `Bearer ${SB_KEY}` }) };
const db = async (path, init = {}) => {
  const res = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, Prefer: "return=representation", ...(init.headers ?? {}) } });
  const t = await res.text();
  if (!res.ok) throw new Error(`db ${path}: ${t}`);
  return t ? JSON.parse(t) : null;
};
const check = (cond, msg) => {
  console.log(`${cond ? "ok" : "NOT OK"} - ${msg}`);
  lines.push(`- ${cond ? "✅" : "❌"} ${msg}`);
  if (!cond) failures++;
};
async function newUser(role, email, name) {
  const res = await fetch(`${SB}/auth/v1/admin/generate_link`, { method: "POST", headers: H, body: JSON.stringify({ type: "magiclink", email, data: { role, full_name: name } }) });
  const b = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(b));
  users.push(b.id ?? b.user?.id);
  return { id: b.id ?? b.user?.id, token: b.hashed_token ?? b.properties?.hashed_token };
}
async function reviewSnapshot(page) {
  const v = async (role, name) => (await page.getByRole(role, { name }).count()) ? page.getByRole(role, { name }).first().inputValue() : null;
  return {
    business: await v("textbox", "Business name"),
    postcode: await v("textbox", "Postcode or area (e.g. M14)"),
    sessions: await page.getByLabel("Session name", { exact: true }).evaluateAll((els) => els.map((e) => e.value)),
    prices: await page.getByLabel("Price", { exact: true }).evaluateAll((els) => els.map((e) => e.value)),
    hours: await page.getByLabel("Day", { exact: true }).evaluateAll((els) => els.map((e) => e.options[e.selectedIndex].text)),
    questions: await page.locator("text=A few quick questions").count(),
    problems: await page.locator("p:has-text(\"didn't let us read\"), p:has-text(\"couldn't\")").allInnerTexts(),
    notes: await page.locator("h2:has-text('Notes') + ul li").allInnerTexts(),
  };
}
async function draft(page) {
  const t0 = Date.now();
  await page.click('button:has-text("Fill my profile for me")');
  await page.waitForFunction(() => document.body.innerText.includes("Your profile") || /couldn't|used today's/.test(document.body.innerText), null, { timeout: 120000 });
  return ((Date.now() - t0) / 1000).toFixed(1);
}

const browser = await chromium.launch(process.env.E2E_BROWSER_PROXY ? { proxy: { server: process.env.E2E_BROWSER_PROXY } } : {});
try {
  // A real public page to read: a published test coach.
  const a = await newUser("coach", `live-setup-a-${run}@example.com`, "Priya Test");
  const slugA = `live-setup-src-${run}`;
  const [coachA] = await db("coaches", { method: "POST", body: JSON.stringify({ profile_id: a.id, business_name: "Priya Shah Football Coaching", slug: slugA, published: true, postcode: "M20 2RN",
    bio: "I'm Priya, a UEFA B coach in Didsbury helping players aged 8-16 build confidence on the ball.", qualifications: "UEFA B Licence\nFA Safeguarding Children" }) });
  await db("services", { method: "POST", body: JSON.stringify([
    { coach_id: coachA.id, name: "1-to-1 skills session", type: "one_to_one", duration_minutes: 60, price_pence: 3500, max_participants: 1, location: "Fletcher Moss 3G" },
    { coach_id: coachA.id, name: "Small group finishing", type: "group", duration_minutes: 90, price_pence: 1500, max_participants: 6, location: "Fletcher Moss 3G" },
  ]) });
  await db("availability_rules", { method: "POST", body: JSON.stringify([{ coach_id: coachA.id, weekday: 2, start_time: "16:00", end_time: "19:00" }, { coach_id: coachA.id, weekday: 6, start_time: "09:00", end_time: "13:00" }]) });
  const pageA = `${APP}/${slugA}`;

  // ---------- Run 1: website link + Instagram link ----------
  const b = await newUser("coach", `live-setup-b-${run}@example.com`, "Test Coach");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${APP}/auth/confirm?next=/coach/setup&token_hash=${b.token}&type=email`);
  await page.waitForURL(`${APP}/coach/setup`);
  check(true, "'Fill my profile for me' page is live");
  await page.getByLabel("Link 1").fill(pageA);
  await page.click("text=+ Add another link");
  await page.getByLabel("Link 2").fill("https://www.instagram.com/instagram/");
  let secs = await draft(page);
  let snap = await reviewSnapshot(page);
  lines.push(`\n## Run 1: a website link + an Instagram link (${secs}s)\n\n\`\`\`json\n${JSON.stringify(snap, null, 2)}\n\`\`\``);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/run1.png`, fullPage: true });
  check(/priya/i.test(snap.business ?? ""), `reads the website: business name "${snap.business}"`);
  check(snap.prices.includes("35") && snap.prices.includes("15"), `prices from the page: ${snap.prices.join(", ")}`);
  check(snap.hours.length >= 2, `weekly hours from the page: ${snap.hours.join(", ")}`);
  check(snap.problems.some((p) => /Instagram/.test(p)) || snap.notes.length >= 0, `Instagram link: ${snap.problems.find((p) => /Instagram/.test(p)) ?? "read without a problem message (see notes)"}`);

  // ---------- Run 2: screenshot only ----------
  await page.click("text=Start again");
  await page.getByLabel("Link 1").fill("");
  if (await page.getByLabel("Link 2").count()) await page.getByLabel("Link 2").fill("");
  const sp = await ctx.newPage();
  await sp.setViewportSize({ width: 430, height: 760 });
  await sp.setContent(`<div style="font-family:-apple-system,Arial;padding:16px;width:398px">
    <div style="display:flex;align-items:center;gap:18px"><div style="width:86px;height:86px;border-radius:50%;background:radial-gradient(circle at 50% 38%,#f2c9a0 28%,#2b2b2b 29%,#2b2b2b 40%,#3a7bd5 41%);"></div>
    <div><b style="font-size:18px">jordan.coaches.football</b><div style="font-size:13px;color:#555">24 posts · 312 followers · 180 following</div></div></div>
    <div style="margin-top:12px;font-size:14px;line-height:1.45"><b>Jordan Ellis Football</b><br>⚽ UEFA C coach · DBS checked<br>1-to-1 sessions £30/hr (ages 6-12)<br>Small groups (max 5) £12 each · Sundays 10-1<br>📍 Salford, M6 · DM to book</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-top:14px">${'<div style="aspect-ratio:1;background:#9bbf6a"></div>'.repeat(6)}</div></div>`);
  const png = await sp.screenshot({ type: "png" });
  await sp.close();
  await page.getByLabel("Add screenshots").setInputFiles({ name: "instagram.png", mimeType: "image/png", buffer: png });
  await page.getByAltText("Screenshot 1").waitFor();
  secs = await draft(page);
  snap = await reviewSnapshot(page);
  lines.push(`\n## Run 2: one Instagram-style screenshot (${secs}s)\n\n\`\`\`json\n${JSON.stringify(snap, null, 2)}\n\`\`\``);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/run2.png`, fullPage: true });
  check(/jordan/i.test(snap.business ?? ""), `reads the screenshot: business name "${snap.business}"`);
  check(snap.prices.includes("30") && snap.prices.includes("12"), `prices from the screenshot: ${snap.prices.join(", ")}`);
  check(snap.hours.some((h) => h === "Sunday"), `hours from the screenshot: ${snap.hours.join(", ")}`);
  check(/M6/i.test(snap.postcode ?? ""), `postcode area: ${snap.postcode}`);

  // Claude should find the round profile picture and frame it (no manual cropping here)
  const preselected = (await page.getByRole("radio", { name: "Use screenshot 1 for my photo" }).getAttribute("aria-checked")) === "true";
  check(preselected, "Claude found the profile picture and pre-selected the screenshot");
  if (!preselected) await page.getByRole("radio", { name: "Use screenshot 1 for my photo" }).click();
  await page.getByRole("img", { name: /Photo crop area/ }).waitFor();
  await page.waitForTimeout(500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/run2-photo.png`, fullPage: true });
  // Leave any price-less sessions unticked so saving is allowed
  await page.click(`button:has-text("Save what's ticked")`);
  await page.getByRole("heading", { name: "Saved" }).waitFor({ timeout: 60000 });
  const [coachB] = await db(`coaches?profile_id=eq.${b.id}&select=id,slug,photo_url,dbs_checked,published`);
  check(Boolean(coachB?.photo_url) && !coachB.dbs_checked, `saved with a cropped photo; DBS left for the coach to tick (page /${coachB?.slug})`);
  // The middle of the saved photo should be the round picture's face colour, not the white page or green post grid.
  const [r, g, bl] = await page.evaluate(async (src) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.src = src;
    await im.decode();
    const c = document.createElement("canvas");
    c.width = im.naturalWidth;
    c.height = im.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(im, 0, 0);
    return Array.from(ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data);
  }, coachB.photo_url);
  lines.push(`\nSaved photo centre colour: rgb(${r}, ${g}, ${bl}) (face colour in the test picture is rgb(242, 201, 160))`);
  check(Math.abs(r - 242) < 40 && Math.abs(g - 201) < 40 && Math.abs(bl - 160) < 40, `the saved photo is centred on the profile picture (centre colour rgb(${r}, ${g}, ${bl}))`);
  if (await page.getByRole("button", { name: "Publish my page" }).count()) {
    await page.getByRole("button", { name: "Publish my page" }).click();
    await page.waitForTimeout(3000);
  }
  const [after] = await db(`coaches?id=eq.${coachB.id}&select=published`);
  check(after.published, "published straight from the setup screen");
  if (SHOTS) {
    const pub = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
    await pub.goto(`${APP}/${coachB.slug}`);
    await pub.waitForTimeout(1500);
    await pub.screenshot({ path: `${SHOTS}/published.png` });
  }
  console.log(failures ? `${failures} CHECK(S) NOT OK` : "ALL LIVE SETUP CHECKS OK");
} finally {
  await browser.close();
  if (REPORT) writeFileSync(REPORT, lines.join("\n"));
  for (const id of users.filter(Boolean)) {
    const list = await (await fetch(`${SB}/storage/v1/object/list/coach-photos`, { method: "POST", headers: H, body: JSON.stringify({ prefix: `${id}/` }) })).json().catch(() => []);
    const files = Array.isArray(list) ? list.map((f) => `${id}/${f.name}`) : [];
    if (files.length) await fetch(`${SB}/storage/v1/object/coach-photos`, { method: "DELETE", headers: H, body: JSON.stringify({ prefixes: files }) });
    await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: H });
  }
  console.log(`cleanup - removed ${users.length} test users and their photos/data`);
}
