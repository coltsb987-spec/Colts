# CoachBook UK

A booking platform for UK football coaches, with an AI receptionist.
Built with Next.js 16 (App Router, TypeScript), Tailwind CSS 4 and Supabase.

**Status: Phases 1, 2, 3 and 3b are done.**
- **Phase 1:** coaches sign up, build a profile, add sessions and prices, set weekly hours and holidays, and publish
  a public page at `/<their-link>`. Parents sign up and add players.
- **Phase 2:** parents book and pay online. Coaches connect their own Stripe account and get paid directly. Coaches
  see upcoming sessions and earnings, can cancel (with automatic refund) or move sessions, and can start the
  £40/month plan with a free trial. Confirmation emails and day-before reminders are sent too.
- **Phase 3:** an AI receptionist (Claude) chats on each coach's page. It answers from the coach's own FAQs and
  profile, checks free times, takes bookings with Stripe payment links, cancels or moves bookings within the
  coach's rule, and hands anything else to the coach. Coaches set its tone, FAQs and rules, and read and reply to
  every conversation under Messages.
- **Phase 3b – "Fill my profile for me":** in onboarding a coach pastes a link (website, Facebook, Instagram or
  any bio page), their bio text, or up to 3 screenshots. Our server fetches the page safely: public addresses only,
  every redirect checked, 8-second timeout and a size cap. It sends the text or images to Claude, which drafts the
  business name, bio, qualifications, postcode area, sessions (name, type, length, price), usual hours and FAQ
  answers (screenshots of Instagram/Facebook profiles or posts work too, up to 5). It uses only facts given, and asks up to 5 questions about anything missing from the minimum. The coach
  edits and ticks what to keep; nothing is saved until they confirm. Unreadable links (Instagram often blocks) are
  explained in plain words, with the text and screenshot options offered instead. Publishing needs only a name, one
  session and some hours; the photo, qualifications, DBS and Stripe come later from the checklist. The DBS box is
  never ticked for the coach. If a screenshot shows the coach's own profile picture, Claude finds it and the
  photo crop is pre-framed on it; the coach can adjust it, pick another screenshot or choose no photo.

## What's where

| Path | What it is |
| --- | --- |
| `supabase/migrations/` | Database tables, row-level security, photo storage bucket |
| `supabase/templates/` | Sign-in email (works on any device) |
| `supabase/rls_tests/` | Tests showing who can and can't see each table |
| `src/app/login`, `src/app/auth`, `src/app/signup`, `src/app/forgot-password`, `src/app/reset-password` | Sign-in for coaches and parents: email link or password, sign-up, forgot/reset password |
| `src/lib/password.ts` | Password rules (10+ characters, not common, not from your email) |
| `src/app/coach/*` | Coach dashboard: overview, profile, sessions & prices, availability |
| `src/app/parent` | Parent area: manage players (with consent) |
| `src/app/[slug]` | Public coach booking page |
| `src/lib/validation.ts` | Form rules (prices, postcodes, booking links, times) |
| `src/lib/slots.ts` | Slot engine: weekly hours + holidays + bookings → free times (UK time, clock changes) |
| `src/lib/bookings.ts` | Confirm, cancel (with refund), reschedule, emails |
| `src/app/[slug]/book/[serviceId]` | Parent booking flow → Stripe Checkout |
| `src/app/coach/bookings`, `src/app/coach/payments` | Coach bookings, earnings, Stripe and plan |
| `src/app/api/stripe/webhook` | Stripe events (payments, subscriptions) |
| `src/app/api/cron/reminders` | Daily reminder emails (Vercel Cron, see `vercel.json`) |
| `src/lib/receptionist/` | AI receptionist: instructions (`prompt.ts`), tools (`tools.ts`), one chat turn (`run.ts`) |
| `src/app/api/receptionist/[slug]` | Chat endpoint used by the widget (with spending limits) |
| `src/app/coach/receptionist`, `src/app/coach/messages` | Coach settings, conversations and replies |
| `src/lib/setup-assistant/`, `src/app/coach/setup` | "Fill my profile for me": draft format, Claude calls, review screen |
| `scripts/live-receptionist-check.mjs` | Real-Claude conversations against a deployed site, with cost per message |
| `scripts/e2e-phase1.mjs` … `e2e-phase3.mjs` | Click through each phase in a real browser |
| `scripts/mock-claude.mjs` | Scripted stand-in for the Claude API, for testing the receptionist's plumbing without a key |

## Environment variables

Set these in Vercel (Settings → Environment Variables) and in `.env.local` for local development. See `.env.example`.

| Name | Needed for | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Everything | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Everything | Safe to expose |
| `SUPABASE_SECRET_KEY` | Bookings, payments, AI features | Server-only; bypasses row-level security |
| `NEXT_PUBLIC_SITE_URL` | Email links, Stripe redirects | e.g. `https://colts-one.vercel.app` |
| `STRIPE_SECRET_KEY` | Payments | `sk_test_…` until launch |
| `STRIPE_WEBHOOK_SECRET` | Payments | Webhook for "Your account" events |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Payments | Webhook for "Connected accounts" events |
| `PLATFORM_FEE_PERCENT` | Optional | CoachBook's cut per booking (default 0) |
| `SUBSCRIPTION_TRIAL_DAYS` | Optional | Free trial on the £40/month plan (default 60) |
| `CRON_SECRET` | Reminder emails | Any long random string; Vercel Cron sends it |
| `RESEND_API_KEY` | Emails | Without it, emails are skipped (logged) |
| `EMAIL_FROM` | Emails | e.g. `CoachBook UK <bookings@mycoachbook.co.uk>` |
| `EMAIL_REPLY_TO` | Optional | Inbox for replies when there's no coach to reply to |
| `ANTHROPIC_API_KEY` | AI receptionist, "Fill my profile for me" | Server-only. Without it, both AI features are hidden |
| `RECEPTIONIST_MODEL` | Optional | Default `claude-opus-5-5`; e.g. `claude-sonnet-5-5` |
| `RECEPTIONIST_MAX_MESSAGES_PER_CHAT` | Optional | Default 30 |
| `RECEPTIONIST_MAX_CHATS_PER_IP_HOUR` | Optional | Default 10 |
| `RECEPTIONIST_MAX_MESSAGES_PER_COACH_DAY` | Optional | Default 300 |
| `SETUP_ASSISTANT_MODEL` | Optional | Model for "Fill my profile for me"; defaults to `RECEPTIONIST_MODEL`, then `claude-opus-5-5` |
| `SETUP_ASSISTANT_DRAFTS_PER_DAY` | Optional | Drafts per coach per day (default 10) |

## Run it on your computer

You need Node.js 20+ and Docker Desktop.

```bash
cd coachbook
npm install
npm run db:start          # starts a local Supabase in Docker and creates the tables
cp .env.example .env.local
```

`db:start` prints a `PUBLISHABLE_KEY`. Put it in `.env.local` with
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`. Then:

```bash
npm run dev               # open http://localhost:3000
```

Sign-in emails don't really get sent locally. Open the test inbox at **http://127.0.0.1:54324** and click the link there.

## Connect a real Supabase project (for Vercel)

1. Create a project at supabase.com. Pick the **London (eu-west-2)** region for UK data.
2. Link it and push the database: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. In **Authentication → URL Configuration**, set the Site URL to your live address and add
   `https://<your-domain>/**` to Redirect URLs.
4. In **Authentication → Emails → Templates**, paste `supabase/templates/magic_link.html` into both
   "Magic link" and "Confirm signup", and `supabase/templates/recovery.html` into "Reset password".
   In **Authentication → Providers → Email**, keep "Confirm email" on and set the minimum password length to 10.
5. Set up custom SMTP (for example Resend) under **Authentication → Emails → SMTP**. Supabase's built-in email is only for testing and is heavily rate-limited.
6. On Vercel, import the repo, set the **Root Directory** to `coachbook`, and add the three variables from
   `.env.example`.

## Tests

```bash
npm test          # unit tests (form rules, prices, links)
npm run test:db   # security tests for every table (needs PostgreSQL installed locally; no Docker needed)
npm run test:e2e  # Phase 1 browser walk-through (needs db:start + dev running)
node scripts/e2e-phase2.mjs   # Phase 2: booking, Stripe Checkout, webhooks (needs Stripe test keys)
node scripts/mock-claude.mjs 4010 /tmp/mock.jsonl &   # then start dev with ANTHROPIC_BASE_URL=http://127.0.0.1:4010
MOCK_LOG=/tmp/mock.jsonl node scripts/e2e-phase3.mjs  # Phase 3: receptionist plumbing
npm run lint && npm run typecheck && npm run build
```

## Security model (short version)

- Every table has row-level security switched on. Coaches only see their own data. Parents only see their own
  players and bookings. A coach can see a player's first name only once that player has booked with them.
- Coaches can't change their own Stripe account, subscription status or role. Only the server can.
- Nobody can make themselves an admin at sign-up.
- The public page reads from a `public_coaches` view. It shows the postcode area only (e.g. "M14"), never the full postcode.
- Bookings are created and changed only on the server, through database functions. The database itself refuses
  double-bookings, using an exclusion constraint.
- Payments are "direct charges": each coach has their own Stripe account, and Stripe (not CoachBook) handles
  disputes and losses. Stripe webhooks are signature-checked and processed once only.
- If a refund fails, the booking is not cancelled, so a parent never loses money.
- DBS status is shown as "coach-declared" until there's an admin verification step.

## How payments work

1. **A coach connects Stripe.** They click Payments → Connect Stripe and fill in Stripe's form. They get a full
   Stripe account of their own.
2. **A parent books.** The time is held for 35 minutes while they pay on Stripe Checkout. The money goes straight
   to the coach's Stripe account. An optional CoachBook fee can be taken with `PLATFORM_FEE_PERCENT`.
3. **The booking is confirmed** when Stripe reports the payment. This happens via the webhook, or straight away
   when the parent returns from Stripe, whichever comes first. If the parent leaves without paying, the time is
   released.
4. **Coach plan.** Pilot coaches can take bookings for free. "Start plan" begins the £40/month subscription with a
   free trial (`SUBSCRIPTION_TRIAL_DAYS`), and no card is needed to start.

## How the AI receptionist works

- **Model:** Claude Opus 5.5 (`claude-opus-5-5`) on low effort, which suits chat. Change it with `RECEPTIONIST_MODEL`.
  If Claude declines a request on safety grounds, the API retries it on a fallback model automatically.
- **Tools:** `get_services`, `check_availability`, `create_booking` (sends a payment link), `list_my_players`,
  `list_my_bookings`, `cancel_booking`, `reschedule_booking`, `answer_faq` and `hand_off_to_coach`. Every tool
  runs on our server with the same checks as the website, so the AI can never do more than the person chatting could.
- **Who's chatting:** anonymous visitors can ask questions, check times and get a sign-in-and-book link. Signed-in
  parents can book, cancel and move their own bookings in the chat. Each chat is tied to a random token kept in
  the visitor's browser; only its hash is stored.
- **Children's data:** the AI asks only for a first name and age group, and gets the adult's consent before saving
  a new player.
- **Spending limits:** 30 messages per chat, 10 new chats per hour per visitor, and 300 messages per coach per day.
  The instructions are cached, so repeat turns cost less.
- **Hand-off:** the AI flags the chat, the coach gets an email, and the coach replies from Messages. The reply
  appears in the visitor's chat, and is also emailed to them if they left an address.

## Next: Phase 4

Pilot launch: onboard pilot coaches, collect weekly feedback, track bookings per coach, AI-handled enquiries and
churn, then move pilots to the paid plan. Later: SMS/WhatsApp via Twilio and Google Calendar sync.
