# CoachBook UK

A booking platform for UK football coaches, with an AI receptionist (coming in Phase 3).
Built with Next.js 16 (App Router, TypeScript), Tailwind CSS 4 and Supabase.

**Status: Phases 1 and 2 are done.**
- **Phase 1:** coaches sign up, build a profile, add sessions and prices, set weekly hours and holidays, and publish
  a public page at `/<their-link>`. Parents sign up and add players.
- **Phase 2:** parents book and pay online. Coaches connect their own Stripe account and get paid directly. Coaches
  see upcoming sessions and earnings, can cancel (with automatic refund) or move sessions, and can start the
  £40/month plan with a free trial. Confirmation emails and day-before reminders are sent too.

## What's where

| Path | What it is |
| --- | --- |
| `supabase/migrations/` | Database tables, row-level security, photo storage bucket |
| `supabase/templates/` | Sign-in email (works on any device) |
| `supabase/rls_tests/` | Tests showing who can and can't see each table |
| `src/app/login`, `src/app/auth` | Magic-link sign-in for coaches and parents |
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
| `scripts/e2e-phase1.mjs`, `scripts/e2e-phase2.mjs` | Click through each phase in a real browser |

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
   "Magic link" and "Confirm signup".
5. Set up custom SMTP (for example Resend) under **Authentication → Emails → SMTP**. Supabase's built-in email is only for testing and is heavily rate-limited.
6. On Vercel, import the repo, set the **Root Directory** to `coachbook`, and add the three variables from
   `.env.example`.

## Tests

```bash
npm test          # unit tests (form rules, prices, links)
npm run test:db   # security tests for every table (needs PostgreSQL installed locally; no Docker needed)
npm run test:e2e  # Phase 1 browser walk-through (needs db:start + dev running)
node scripts/e2e-phase2.mjs   # Phase 2: booking, Stripe Checkout, webhooks (needs Stripe test keys)
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

## Next: Phase 3

The AI receptionist: a web chat widget, Claude tool use for availability and bookings, coach tone, FAQs and rules,
hand-off to the coach, and a conversation log.
