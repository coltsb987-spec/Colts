# CoachBook UK - Stage 1: Project audit and foundation plan

Date of audit: 3 November 2026. Audit only: no existing files were changed or deleted, nothing was
installed into the repository, nothing was deployed, and no paid service or API was used.

---

## 1. Short version (plain English)

- **This branch does not contain any CoachBook code yet.** The branch `claude/coachbook-uk-audit-efhisn`
  is a copy of your *AI Business Influencer Factory* (a Python tool for making Reels/Shorts). It has
  nothing to do with football coaching or bookings.
- **There is a very useful head start on another branch.** `claude/database-secure-login-b6yvc7`
  contains **CallPilot UK** (`callpilot-uk/`): a small Next.js + Supabase app with secure email/password
  login, a database with strong access rules, form validation and tests. That is exactly the
  technology you chose for CoachBook.
- **CallPilot works.** I ran it in a scratch copy: it installs, type-checks, lints, builds, and all
  37 tests pass (28 unit tests + 9 database security tests against a local Postgres).
- **One serious thing to fix first:** it uses Next.js 14.2.35, which has known security advisories
  (`npm audit`: 1 critical, 1 high). Upgrading Next.js is the first job before anything goes public.
- **Recommendation:** build CoachBook as a new folder `coachbook-uk/` that *copies* CallPilot's proven
  login, database-security and testing foundation, then adds coaches, services, availability and a
  single shared booking engine. CallPilot itself stays untouched.

---

## 2. What already exists

The GitHub repository `coltsb987-spec/Colts` has three branches:

| Branch | Contents | Relevant to CoachBook? |
| --- | --- | --- |
| `claude/ai-influencer-factory-z0hhis` | AI Business Influencer Factory (Python) | No |
| `claude/coachbook-uk-audit-efhisn` (this one) | Identical to the influencer factory branch, plus this report | Only this report |
| `claude/database-secure-login-b6yvc7` | Influencer factory **plus** `callpilot-uk/` (Next.js + Supabase) | **Yes - main thing to reuse** |

### 2a. AI Business Influencer Factory (on this branch)
- **Framework:** plain Python 3 (standard library only, no packages). One script, `factory.py`
  (about 1,500 lines), plus folders `00_planning/` to `10_analytics/`, `config/`, `docs/`, `prompts/`,
  `templates/`, `tests/`.
- **Dependencies:** Python 3; FFmpeg for video assembly. No `package.json`, no Next.js, no Supabase.
- **Environment variables:** `.env.example` lists only `IG_USER_ID` and `IG_ACCESS_TOKEN`
  (optional Instagram research). No `.env` file exists; `.env` is git-ignored.
- **Tests:** `python3 -m unittest discover tests` -> **27 tests, all pass** (about 68 seconds).
- **Booking/auth/database:** none. The word "booking" only appears inside video scripts.

### 2b. CallPilot UK (`callpilot-uk/` on `claude/database-secure-login-b6yvc7`)
An AI-receptionist dashboard for UK businesses, Stage 1 complete. No telephony is connected.

| Area | What is there |
| --- | --- |
| Framework | Next.js **14.2.35** (App Router, server actions), React 18, TypeScript (strict) |
| Dependencies | `@supabase/ssr`, `@supabase/supabase-js`, `zod` (validation), `lucide-react` (icons), `server-only` |
| Dev tools | Vitest 4, ESLint (next config), `pg` for database tests. Node >= 20.19 |
| Supabase | Configured in code (`lib/supabase/server.ts`, `lib/supabase/middleware.ts`, `lib/env.ts`), local CLI config `supabase/config.toml`, one migration `supabase/migrations/20261024000000_stage1_workspaces_auth.sql`. **No real Supabase project is connected** (no `.env.local`, no keys anywhere - correct). |
| Database tables | `workspaces`, `workspace_members` (roles owner/admin/member), `businesses`, `calls`. Row level security (RLS) on every table; signed-out visitors get no access; helper functions in a locked-down `private` schema; trigger creates a workspace for every new user; `workspace_call_stats()` summary function. |
| Authentication | Email + password sign-up/sign-in/sign-out via Supabase Auth, email-confirmation route (`/auth/confirm`), middleware that refreshes the session and sends signed-out users to `/login`, server-side `getUser()` checks, safe redirects (no open redirects), generic error messages (no account enumeration), password 10-72 characters. |
| Booking functionality | **None.** Only a `booking_requested` value in the call-outcome list. |
| UI components | `Dashboard.tsx` (tabbed dashboard with sidebar, stats, tables, "add business" form, empty states), `LoginForm.tsx`, `SetupNeeded.tsx`, global `error.tsx` and `loading.tsx`, `globals.css`. |
| Tests | Unit: validation, server actions, dashboard mapping, routes. Database: 9 RLS tests that apply the migration to a throwaway Postgres DB and act as two different users. |
| CI | None (no `.github/workflows`). |

---

## 3. What works (verified by running it)

Run in a scratch copy outside the repository, using only free local tools:

| Check | Result |
| --- | --- |
| `npm ci` | Installs cleanly |
| `npm run typecheck` | Passes, no errors |
| `npm run lint` | "No ESLint warnings or errors" |
| `npm test` | 28 passed, 9 skipped (DB tests skip without a database) |
| `npm run test:db` (local Postgres 16) | **9 of 9 passed** |
| `npm run build` | Production build succeeds (`/`, `/login`, `/auth/confirm`, middleware) |
| Influencer factory `python3 -m unittest discover tests` | 27 of 27 passed |

Not checked: sign-up/sign-in against a real Supabase project (none is connected, and I must not
create accounts or invent keys).

---

## 4. What is unfinished

For CoachBook purposes, everything booking-related is missing:
- Parent vs coach vs admin roles (CallPilot only has workspace roles).
- Coach profiles, services, prices, locations, availability, diary.
- Slot calculation, the booking engine, double-booking protection, cancellations.
- Public (signed-out) pages: coach search and profiles. CallPilot currently makes **every** page
  require login.
- Booking confirmation and reminder emails, and a scheduler to send reminders.
- Password reset screen ("forgot password"), account deletion, data export.
- Admin tools for you (approve coaches, see pilot usage and costs).
- Privacy notice, terms, safeguarding policy, cookie notice.
- CI (automatic checks on every push), error monitoring, backups plan.
- Later stages: AI website chat, Stripe, WhatsApp, telephone AI.

---

## 5. What needs fixing (security and technical issues)

| # | Severity | Issue | Fix |
| --- | --- | --- | --- |
| 1 | **High** | `next@14.2.35` has many published advisories (`npm audit --omit=dev`: 1 critical in `next`, 1 high in bundled `postcss`) - mostly denial-of-service, cache-poisoning and SSRF classes. | Upgrade to a currently supported Next.js release in the CoachBook copy. Breaking change: `cookies()` / `headers()` become async, so `lib/supabase/server.ts` and `app/actions/auth.ts` need small edits. Re-run all tests. |
| 2 | Medium | No HTTP security headers (Content-Security-Policy, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`). | Add headers in `next.config` (or middleware) during Phase 0. |
| 3 | Medium | Sign-up trigger gives **every** new user a workspace. In CoachBook, parents must not get a coach business. | Replace with a `profiles` row and an explicit role; coaches created by invitation during the pilot. |
| 4 | Medium | Local `supabase/config.toml` has `enable_confirmations = false` for email. Fine for local testing, but the hosted project must keep email confirmation **on**. | Document and check in the pilot checklist. |
| 5 | Medium | Supabase's built-in email sender is meant for testing and is heavily rate-limited, so it cannot be relied on for auth emails *or* booking emails in a pilot. | Plan a transactional email provider with custom SMTP (verify free-tier limits before choosing). No purchase now. |
| 6 | Low | No "forgot password" UI (the confirm route already accepts `recovery` links). | Add in Phase 1. |
| 7 | Low | No CI workflow, so tests only run if someone remembers. | Add a GitHub Actions workflow running typecheck, lint, unit and DB tests (free for this usage; verify). |
| 8 | Low | Repository mixes two unrelated products, and the root `CLAUDE.md` describes the influencer factory. Future AI coding sessions get the wrong instructions. | Add `coachbook-uk/CLAUDE.md` with CoachBook rules, or (better long-term) move CoachBook to its own repository - your call. |
| 9 | Info | This branch is based on the influencer branch, not on the CallPilot branch, so `callpilot-uk/` is not present here. | Copy the needed files into `coachbook-uk/` (see section 6). |

No secrets were found in any branch. `.env`, `.env.local` and `.env*.local` are git-ignored, and the
only service key the browser would see is the public Supabase publishable key, which is safe because
of RLS.

### Missing environment variables / integrations (names only, no values)
| Variable | Needed from | Status |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Phase 0 (local Supabase gives this for free) | Not set |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Phase 0 | Not set |
| `NEXT_PUBLIC_SITE_URL` | Phase 0 | Not set (defaults work locally) |
| `SUPABASE_SECRET_KEY` (server-only, never `NEXT_PUBLIC_`) | Phase 6 (sending reminders from a background job) | Not set, not needed yet |
| `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM` | Phase 6 | Provider not chosen |
| `TEST_DATABASE_URL` | Tests only | Local only |
| `STRIPE_*`, `TWILIO_*`, WhatsApp, AI model keys | Later stages | Not needed for the pilot |

---

## 6. What to reuse vs build from scratch

### Reuse (copy from `callpilot-uk/` into `coachbook-uk/`, CallPilot left unchanged)
- Project setup: `package.json` (then upgrade Next.js), `tsconfig.json`, `vitest.config.ts`,
  `.eslintrc.json`, `.gitignore`, `.env.example` pattern.
- `lib/env.ts`, `lib/supabase/server.ts`, `lib/supabase/middleware.ts`, `middleware.ts`
  (with a public-path list extended for search and coach pages).
- `lib/routes.ts` (`safeRedirectPath`, `isPublicPath`) and its tests.
- `lib/validation.ts` pattern (zod schemas + `firstErrors`) and its tests.
- `app/actions/auth.ts`, `app/auth/confirm/route.ts`, `app/login/page.tsx`, `components/LoginForm.tsx`.
- `app/error.tsx`, `app/loading.tsx`, `components/SetupNeeded.tsx` (re-worded).
- Migration conventions: RLS everywhere, `private` schema helpers with `security definer` +
  `search_path = ''`, column-level grants, ownership-lock triggers, `updated_at` trigger.
- The database test harness `tests/db/rls.test.ts` + `tests/db/supabase_stub.sql` - extremely
  valuable for proving one coach can't see another coach's data or a parent's children.
- `Dashboard.tsx` layout and styling as the starting point for the coach dashboard.

### Build from scratch
- Roles and profiles (parent / coach / admin).
- Coach profile, services, prices, locations, availability rules and exceptions.
- Slot generator (pure TypeScript, heavily tested, Europe/London time zone and clock changes).
- **Shared booking engine** in the database (`create_booking`, `cancel_booking`, `reschedule_booking`)
  so the website, AI chat, WhatsApp and phone all go through exactly the same rules.
- Public search and coach profile pages, parent booking flow, child details.
- Notification outbox, confirmation and reminder emails, scheduler.
- Admin area and pilot usage/cost tracking.
- Legal and safeguarding pages and data-rights tools.

---

## 7. Recommended database structure

Principles: all times stored as `timestamptz` (UTC) and shown in `Europe/London`; money stored as
whole pence (`integer`); RLS on every table; parents and coaches only ever see their own data;
**bookings are only created through database functions**, never by direct inserts from the browser
or an AI agent; minimal data about children (UK GDPR - children's data needs extra care).

### Pilot tables

| Table | Key columns | Who can see/change it |
| --- | --- | --- |
| `profiles` | `id` (= `auth.users.id`), `role` (`parent`/`coach`/`admin`), `full_name`, `phone`, `marketing_opt_in`, timestamps | Owner reads/edits own row (not `role`). Admin reads all. Created by sign-up trigger. |
| `coaches` | `id`, `user_id` (unique), `slug` (unique, for URLs), `display_name`, `bio`, `photo_path`, `area_label` (e.g. "Leeds North"), `postcode_district` (e.g. "LS17"), `qualifications`, `dbs_checked_on` (set by admin only), `is_published`, `min_notice_hours`, `max_advance_days`, `cancellation_policy` | Public can read **published** coaches (safe columns only). Coach edits own row except `dbs_checked_on` / `is_published`. Admin approves. |
| `locations` | `id`, `coach_id`, `name`, `address_line`, `town`, `postcode`, `latitude`, `longitude`, `is_active` | Public reads active locations of published coaches; coach manages own. |
| `services` | `id`, `coach_id`, `name`, `description`, `session_type` (`one_to_one`/`small_group`/`group`), `duration_minutes`, `price_pence`, `capacity` (1 for one-to-one), `age_min`, `age_max`, `is_active` | Public reads active; coach manages own. |
| `service_locations` | `service_id`, `location_id` | Same as services. |
| `availability_rules` | `id`, `coach_id`, `weekday` (1-7), `start_time`, `end_time` (local time), `location_id` (nullable), `valid_from`, `valid_until` | Coach manages own; public never reads raw rules - only computed free slots. |
| `availability_exceptions` | `id`, `coach_id`, `starts_at`, `ends_at`, `kind` (`blocked`/`extra`), `note` | Coach only. |
| `children` | `id`, `parent_id`, `first_name`, `birth_year` (or age group), `notes` (short, optional - no medical detail in the pilot) | Parent only; a coach sees the child's first name and age only for **their own** bookings. |
| `bookings` | `id`, `coach_id`, `service_id`, `location_id`, `parent_id`, `child_id`, `starts_at`, `ends_at`, `status` (`confirmed`/`cancelled_by_parent`/`cancelled_by_coach`/`completed`/`no_show`), `price_pence` (copied at booking time), `channel` (`web`/`coach_manual`/`ai_chat`/`whatsapp`/`phone`), `idempotency_key` (unique), `parent_note`, `cancelled_at`, `cancel_reason`, timestamps | Parent sees own; coach sees own diary; **no direct insert/update grants** - only via functions. |
| `booking_events` | `id`, `booking_id`, `actor_id`, `actor_kind` (`parent`/`coach`/`admin`/`system`/`ai`), `action`, `details` (jsonb), `created_at` | Audit trail, append-only. Coach/parent read events for their bookings. |
| `notifications` | `id`, `booking_id`, `recipient_id`, `kind` (`confirmation`/`reminder`/`cancellation`), `channel` (`email` now), `send_after`, `sent_at`, `status`, `attempts`, `provider_message_id`, `last_error` | Server only (outbox: rows are written in the same transaction as the booking, then sent by a background job). |
| `usage_events` | `id`, `kind` (e.g. `booking_created`, `email_sent`, `ai_message`), `coach_id`, `quantity`, `estimated_cost_pence`, `created_at` | Admin only. Lets you measure real pilot usage and costs. |
| `coach_invites` | `code_hash`, `email`, `created_by`, `used_by`, `expires_at` | Admin only. Keeps the pilot to your five invited coaches. |

### Booking engine (the heart of the system)
- `public.get_available_slots(coach_id, service_id, from, to)` - computes free start times from rules,
  exceptions, existing bookings, notice period and capacity. Callable by the public.
- `public.create_booking(service_id, location_id, child_id, starts_at, channel, idempotency_key)` -
  `security definer`; checks the signed-in parent owns the child, the slot is genuinely free, the
  service is active and the coach is published; **locks the coach's row** (`select ... for update`)
  so two parents can't take the same last place at the same moment; writes the booking, an event
  and the notification rows in one transaction; returns the booking. Repeat calls with the same
  `idempotency_key` return the same booking instead of making a duplicate (important for AI and
  WhatsApp retries).
- `public.cancel_booking(booking_id, reason)` and later `reschedule_booking(...)` follow the same pattern.
- Backstop: an exclusion constraint (`btree_gist`, `tstzrange(starts_at, ends_at) &&`) so one-to-one
  bookings for the same coach can never overlap, even if code has a bug.
- Every future channel (AI chat, WhatsApp, phone) calls these same functions with its own `channel`
  value - no channel gets its own booking logic.

### Later tables (not for the pilot)
`conversations` / `messages` (AI chat and WhatsApp), `calls` (reuse CallPilot's design),
`stripe_customers`, `subscriptions`, `payments`, `reviews`.

---

## 8. Recommended development order and phased plan

Each phase ends with acceptance tests. A phase is "done" only when all of them pass.
Nothing in Phases 0-7 needs a paid service; local Supabase (Docker) is free.

### Phase 0 - Foundation (CoachBook skeleton)
Copy the reusable CallPilot pieces into `coachbook-uk/`, rename, upgrade Next.js, add security
headers, add `coachbook-uk/CLAUDE.md` and a CI workflow.
**Acceptance tests**
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass in `coachbook-uk/`.
- `npm audit --omit=dev` reports no high or critical issues.
- Copied route/validation/auth unit tests pass; RLS test harness runs against local Postgres.
- `callpilot-uk/` and the influencer factory are byte-for-byte unchanged; `python3 -m unittest discover tests` still passes.
- Response headers include CSP, `frame-ancestors`, `Referrer-Policy`.

### Phase 1 - Accounts and roles
`profiles` table, parent sign-up, coach sign-up by invite code only, admin role (you), forgot-password
flow, role-based redirects (parent home vs coach dashboard). Public pages no longer require login.
**Acceptance tests**
- A new sign-up becomes a `parent`; it cannot make itself `coach` or `admin` (DB test).
- A coach can only be created with a valid, unused, unexpired invite (DB test).
- Signed-out visitor can open `/` and `/coaches/...` but not `/dashboard` (route test).
- Password reset email link signs the user in and lets them set a new password (manual, local Supabase Inbucket).

### Phase 2 - Coach profiles, services, locations
Coach dashboard pages to edit profile, add services (name, length, price in pounds -> pence,
capacity, age range) and locations. Admin can publish/unpublish and record DBS check date.
**Acceptance tests**
- Coach A cannot read or edit Coach B's services/locations (DB tests).
- A coach cannot set `is_published` or `dbs_checked_on` (DB test).
- Price input "£25.50" is stored as `2550`; invalid prices, durations and ages are rejected (unit tests).
- Signed-out visitors see only published coaches and active services (DB test).

### Phase 3 - Availability and slot calculation
Weekly availability rules, holidays/blocked times, notice period, booking window. Pure slot
generator plus `get_available_slots`.
**Acceptance tests**
- Unit tests: rules + exceptions + existing bookings produce the expected slots.
- Clock-change tests: availability on the last Sunday of March and October is correct in Europe/London.
- Slots inside the minimum notice period or beyond the max advance window are not offered.
- A full group session stops being offered; a one-to-one slot disappears once booked.

### Phase 4 - Shared booking engine
`create_booking`, `cancel_booking`, `booking_events`, exclusion constraint, idempotency.
Coach diary view (day/week list) and manual booking by the coach (`channel = coach_manual`).
**Acceptance tests**
- Two simultaneous `create_booking` calls for the last place: exactly one succeeds (concurrency DB test).
- Same `idempotency_key` twice creates one booking.
- Parent cannot book for another parent's child; cannot book an inactive service or unpublished coach.
- Direct `insert into bookings` from an authenticated user is refused (DB test).
- Cancelling frees the slot; every change writes a `booking_events` row.

### Phase 5 - Parent journey (website)
Search by town or postcode district, coach profile with services/prices/locations, live slot picker,
add child, book, "my bookings" with cancel.
**Acceptance tests**
- End-to-end browser test (Playwright, local): search -> profile -> pick slot -> sign up -> add child -> booking confirmed -> appears in coach diary.
- Search only returns published coaches; profile shows no private data (no coach email/phone unless the coach opts in).
- Pages work at phone width and pass basic accessibility checks (labels, contrast, keyboard).

### Phase 6 - Confirmations and reminders
Notification outbox processed by a scheduled job; confirmation on booking, reminder (e.g. 24 hours
before), cancellation notices. Development uses local Supabase's email catcher only - no paid sending.
**Acceptance tests**
- Each booking creates exactly one confirmation and one reminder row in the same transaction.
- Worker sends each notification once, retries failures with a limit, and records errors (unit tests with a fake email sender).
- Cancelled bookings never get reminders.
- Email content uses UK date/time format and correct Europe/London time across clock changes.

### Phase 7 - Pilot readiness (before any real coach or parent uses it)
Admin page (coaches, bookings, usage/costs), `usage_events`, privacy notice, terms, safeguarding
statement, cookie notice, data export and account deletion, error monitoring, backup check,
choose hosting + email provider, **then deploy only with your explicit approval and cost quote**.
**Acceptance tests**
- Pilot checklist signed off: email confirmation on, custom SMTP set, RLS tests pass against the hosted database, no secrets in the repo, security headers present.
- Admin can see bookings per coach and an estimated monthly running cost from `usage_events`.
- A parent can download their data and delete their account; their children's records go with it.
- Free-tier limits (database pausing, email limits, hosting terms for commercial use) checked against the providers' current pages and written down.

### Later stages (after the pilot shows real usage)
8. **Website AI chat** - answers from coach profile data only and books by calling `get_available_slots` / `create_booking` with `channel = ai_chat`; never invents prices or availability; hands over to the coach when unsure. Acceptance: scripted conversations book correctly, refuse to book unavailable slots, and every AI booking is in `booking_events`.
9. **Stripe** - coach subscriptions first (then optional deposits). Test mode only until approved.
10. **WhatsApp AI** - same booking functions, `channel = whatsapp`.
11. **Telephone AI** (Twilio + voice-agent platform) - reuse CallPilot's `calls` design and staged approach; numbers bought only with your explicit approval.

---

## 9. Decisions I need from you before Phase 0

1. **Where should CoachBook live?** Recommended: a new `coachbook-uk/` folder on this branch, copying
   CallPilot's foundation. Alternative: a brand-new repository just for CoachBook (cleaner long-term).
2. **Is CoachBook replacing CallPilot UK, or are both products continuing?** (Affects whether shared
   code should eventually become one codebase.)
3. **Pilot payments:** confirm that parents pay coaches directly (cash/bank transfer) during the
   free pilot, so CoachBook shows prices but takes no money.
4. **Coach checks:** should CoachBook record DBS / FA qualifications (admin-verified) before a coach
   is published? Recommended: yes.
