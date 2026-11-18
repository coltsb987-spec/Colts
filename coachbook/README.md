# CoachBook UK

A booking platform for UK football coaches, with an AI receptionist (coming in Phase 3).
Built with Next.js 16 (App Router, TypeScript), Tailwind CSS 4 and Supabase.

**Status: Phase 1 (Foundations) is done.** Coaches can sign up, build a profile, add sessions and prices,
set weekly hours and holidays, and publish a public page at `/<their-link>`. Parents can sign up and add players.
Online booking and payments come in Phase 2.

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
| `scripts/e2e-phase1.mjs` | Clicks through the whole Phase 1 flow in a real browser |

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
npm run test:e2e  # full browser walk-through (needs db:start + dev running)
npm run lint && npm run typecheck && npm run build
```

## Security model (short version)

- Every table has row-level security switched on. Coaches only see their own data. Parents only see their own
  players and bookings. A coach can see a player's first name only once that player has booked with them.
- Coaches can't change their own Stripe account, subscription status or role. Only the server can.
- Nobody can make themselves an admin at sign-up.
- The public page reads from a `public_coaches` view. It shows the postcode area only (e.g. "M14"), never the full postcode.
- Parent bookings, payments and AI messages will be written server-side (Phase 2/3), never directly from the browser.
- DBS status is shown as "coach-declared" until there's an admin verification step.

## Next: Phase 2

Slot engine plus a double-booking database constraint, the parent booking flow, Stripe Connect and Billing,
webhooks, confirmation and reminder emails, and the coach dashboard for upcoming sessions and earnings.
