# CallPilot UK

A dashboard for a UK-focused AI receptionist service. **No telephony provider is connected yet: the app does not make or receive any phone calls.**

## What works now (Stage 1)
- Email + password sign-up and sign-in (Supabase Auth), sign-out, email confirmation links
- Every page except `/login` and `/auth/*` requires a signed-in user (checked on the server)
- Each new account gets its own private workspace, with the user as owner
- Businesses are saved in the database (Postgres via Supabase) and only visible to members of that workspace
- Call activity and statistics come from the database. There are no calls yet, so they show zero/empty states. No demo or made-up figures.
- Form validation, loading states and error states
- Tests for validation, server actions and the database access rules

## Requirements
- Node.js 20.19 or later, npm
- A Supabase project (the free tier is enough for development), **or** Docker to run Supabase on your computer

## Run it

### 1. Install
```bash
npm install
```

### 2. Create the database
**Option A: hosted Supabase (simplest)**
1. Create a project at supabase.com.
2. Open **SQL Editor**, paste the contents of `supabase/migrations/20261024000000_stage1_workspaces_auth.sql` and run it.
   (Or with the Supabase CLI: `npx supabase link` then `npx supabase db push`.)
3. In **Authentication -> URL Configuration**, set the Site URL to `http://localhost:3000` and add
   `http://localhost:3000/auth/confirm` to the Redirect URLs.

**Option B: Supabase on your computer (needs Docker)**
```bash
npx supabase start    # applies the migrations automatically
npx supabase status   # shows the API URL and publishable/anon key
```

### 3. Add your settings
```bash
cp .env.example .env.local
```
Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the publishable or anon key).
**Never** put the secret / `service_role` key in a `NEXT_PUBLIC_` variable. Stage 1 doesn't need it at all.

### 4. Start
```bash
npm run dev
```
Open http://localhost:3000. You'll be sent to the sign-in page; choose **Create an account**.

## Checks
```bash
npm run typecheck
npm run lint
npm test                 # unit tests; database tests are skipped without a database
TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres npm run test:db
```
The database tests create and drop a throwaway database called `callpilot_rls_test` on the Postgres server you point them at. Use a local development server, never production.

## How security works
- The browser only gets the public Supabase URL and publishable key. All secrets stay server-side.
- Sessions are stored in secure HTTP-only cookies by `@supabase/ssr`. `middleware.ts` refreshes them and redirects signed-out visitors to `/login`.
- The server checks the user with `supabase.auth.getUser()` (verified with Supabase Auth) before loading data or saving anything.
- **Row level security (RLS)** in Postgres is the real gatekeeper: even with the public key, a user can only read or change rows in workspaces they belong to. Signed-out visitors can't read any tables.
- Users can't write call records, change a business's status or phone number, or add themselves to other workspaces. Those will be done by trusted server code in later stages.
- Post-login redirects only go to paths on this site (no open redirects). Sign-in errors don't reveal whether an email is registered.
- Supabase Auth applies its own rate limits to sign-in and sign-up attempts.

## Database tables
| Table | Purpose |
| --- | --- |
| `workspaces` | One per customer account (created automatically at sign-up) |
| `workspace_members` | Who belongs to which workspace, and their role (`owner`, `admin`, `member`) |
| `businesses` | Client businesses managed in a workspace. `phone_number` stays empty until a real number is provisioned |
| `calls` | Call records, written only by the future telephony integration. `is_test` marks sandbox calls |

## Staged plan
1. **Stage 1 (done):** persistent data, secure authentication, per-workspace access, validation, tests.
2. **Stage 2: business profiles.** Edit/delete businesses, opening hours, services, FAQs, escalation contact; workspace invitations and a workspace switcher; account deletion and data export.
3. **Stage 3: provider research and sandbox.** Research UK number availability, inbound call pricing, AI voice options, call forwarding and UK GDPR obligations; pick providers behind a swappable `TelephonyProvider` / `VoiceAgent` interface; build a sandbox flow that creates clearly marked test calls without dialling anyone.
4. **Stage 4: live calls (only with the owner's explicit approval and provider accounts).** Webhooks that write `calls` server-side, recording/transcription disclosures, human transfer, notifications, monitoring.
5. **Stage 5: billing and launch readiness.** Payments, data retention and deletion jobs, privacy notice, DPIA, outage and urgent-call handling.

## Important before launch
This is not yet ready for real callers. It still needs a phone provider and voice agent, call recording/transcription disclosures, payments, data retention and deletion, privacy notices, consent/marketing controls, a human escalation path, outage handling and tested urgent-call behaviour. Verify provider availability and legal requirements for the intended use.
