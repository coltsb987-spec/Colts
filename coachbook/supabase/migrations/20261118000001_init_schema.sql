-- CoachBook UK – initial schema (build plan section 3)
-- Every table has row-level security (RLS) switched on.
-- Coaches see only their own data; parents see only their own players and bookings.
-- Writes that must be trusted (payments, subscriptions, AI receptionist) are done
-- server-side with the service-role key, which bypasses RLS.

create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role         as enum ('coach', 'parent', 'admin');
create type public.service_type      as enum ('one_to_one', 'group', 'camp');
create type public.booking_status    as enum ('pending', 'confirmed', 'cancelled', 'completed', 'no_show');
create type public.payment_status    as enum ('unpaid', 'paid', 'refunded', 'failed');
create type public.booking_source    as enum ('web', 'ai_receptionist', 'coach_manual');
create type public.channel_type      as enum ('web', 'sms', 'whatsapp');
create type public.message_sender    as enum ('customer', 'ai', 'coach');
create type public.exception_kind    as enum ('blocked', 'extra');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.user_role not null default 'parent',
  full_name   text check (char_length(full_name) <= 120),
  phone       text check (char_length(phone) <= 30),
  created_at  timestamptz not null default now()
);

create table public.coaches (
  id                     uuid primary key default gen_random_uuid(),
  profile_id             uuid not null unique references public.profiles (id) on delete cascade,
  business_name          text not null check (char_length(business_name) between 2 and 100),
  slug                   citext not null unique
                           check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 50)
                           check (slug not in ('admin','api','auth','coach','coaches','parent','parents',
                                               'login','logout','signup','sign-in','sign-up','dashboard',
                                               'settings','about','pricing','privacy','terms','help',
                                               'support','book','booking','bookings','_next','static')),
  bio                    text check (char_length(bio) <= 2000),
  photo_url              text check (char_length(photo_url) <= 500),
  postcode               text check (char_length(postcode) <= 10),
  qualifications         text check (char_length(qualifications) <= 1000),
  dbs_checked            boolean not null default false,
  dbs_date               date,
  published              boolean not null default false,   -- only published coaches appear at /[slug]
  stripe_account_id      text,                              -- set by server (Stripe Connect), never by the coach
  subscription_status    text not null default 'pilot',     -- set by server (Stripe webhooks)
  receptionist_settings  jsonb not null default '{"tone": "friendly", "faqs": [], "rules": {}}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table public.services (
  id                uuid primary key default gen_random_uuid(),
  coach_id          uuid not null references public.coaches (id) on delete cascade,
  name              text not null check (char_length(name) between 2 and 100),
  description       text check (char_length(description) <= 1000),
  type              public.service_type not null,
  duration_minutes  integer not null check (duration_minutes between 15 and 720),
  price_pence       integer not null check (price_pence between 0 and 1000000),
  max_participants  integer not null default 1 check (max_participants between 1 and 200),
  location          text check (char_length(location) <= 200),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  check (type <> 'one_to_one' or max_participants = 1)
);
create index services_coach_id_idx on public.services (coach_id);

-- weekday: 0 = Sunday … 6 = Saturday (same as JavaScript Date.getDay()).
-- Times are UK local time (Europe/London).
create table public.availability_rules (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null references public.coaches (id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  location    text check (char_length(location) <= 200),
  created_at  timestamptz not null default now(),
  check (end_time > start_time)
);
create index availability_rules_coach_id_idx on public.availability_rules (coach_id);

-- 'blocked' with no times = whole day off; 'extra' must have times.
create table public.availability_exceptions (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null references public.coaches (id) on delete cascade,
  date        date not null,
  kind        public.exception_kind not null,
  start_time  time,
  end_time    time,
  location    text check (char_length(location) <= 200),
  note        text check (char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  check ((start_time is null and end_time is null) or (start_time is not null and end_time is not null and end_time > start_time)),
  check (kind = 'blocked' or start_time is not null)
);
create index availability_exceptions_coach_date_idx on public.availability_exceptions (coach_id, date);

-- Children's data kept to the minimum: first name, age group, optional notes.
create table public.players (
  id                 uuid primary key default gen_random_uuid(),
  parent_profile_id  uuid not null references public.profiles (id) on delete cascade,
  first_name         text not null check (char_length(first_name) between 1 and 50),
  age_group          text not null check (char_length(age_group) <= 20),
  notes              text check (char_length(notes) <= 500),
  parental_consent_at timestamptz,    -- when the parent confirmed consent (required for under-18s)
  created_at         timestamptz not null default now()
);
create index players_parent_idx on public.players (parent_profile_id);

create table public.bookings (
  id                        uuid primary key default gen_random_uuid(),
  coach_id                  uuid not null references public.coaches (id) on delete cascade,
  service_id                uuid not null references public.services (id) on delete restrict,
  player_id                 uuid references public.players (id) on delete set null,
  booked_by_profile_id      uuid references public.profiles (id) on delete set null,
  start_at                  timestamptz not null,
  end_at                    timestamptz not null,
  status                    public.booking_status not null default 'pending',
  payment_status            public.payment_status not null default 'unpaid',
  stripe_payment_intent_id  text unique,
  source                    public.booking_source not null default 'web',
  created_at                timestamptz not null default now(),
  check (end_at > start_at)
);
create index bookings_coach_start_idx on public.bookings (coach_id, start_at);
create index bookings_booked_by_idx on public.bookings (booked_by_profile_id);
create index bookings_player_idx on public.bookings (player_id);
-- Double-booking prevention (exclusion constraint) is added in Phase 2 with the slot engine.

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  coach_id        uuid not null references public.coaches (id) on delete cascade,
  channel         public.channel_type not null default 'web',
  contact_name    text check (char_length(contact_name) <= 120),
  contact_number  text check (char_length(contact_number) <= 30),
  needs_handoff   boolean not null default false,
  created_at      timestamptz not null default now()
);
create index conversations_coach_idx on public.conversations (coach_id);

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  sender           public.message_sender not null,
  content          text not null check (char_length(content) <= 8000),
  created_at       timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

create table public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  coach_id                uuid not null references public.coaches (id) on delete cascade,
  stripe_subscription_id  text unique,
  plan                    text not null,
  status                  text not null,
  current_period_end      timestamptz,
  created_at              timestamptz not null default now()
);
create index subscriptions_coach_idx on public.subscriptions (coach_id);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.my_coach_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select c.id from public.coaches c where c.profile_id = auth.uid();
$$;

create or replace function public.my_role()
returns public.user_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Is this coach published (publicly visible)?
create or replace function public.coach_is_published(p_coach_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.coaches where id = p_coach_id and published);
$$;

-- Does the current coach have a booking with this player? (lets coaches see player first names)
create or replace function public.player_booked_with_me(p_player_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bookings b
    join public.coaches c on c.id = b.coach_id
    where b.player_id = p_player_id and c.profile_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
-- Create a profile row for every new auth user. The role comes from sign-up
-- metadata but may only be 'coach' or 'parent' – nobody can make themselves admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  requested text := new.raw_user_meta_data ->> 'role';
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    case when requested = 'coach' then 'coach'::public.user_role else 'parent'::public.user_role end,
    nullif(left(new.raw_user_meta_data ->> 'full_name', 120), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger coaches_set_updated_at
  before update on public.coaches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles                enable row level security;
alter table public.coaches                 enable row level security;
alter table public.services                enable row level security;
alter table public.availability_rules      enable row level security;
alter table public.availability_exceptions enable row level security;
alter table public.players                 enable row level security;
alter table public.bookings                enable row level security;
alter table public.conversations           enable row level security;
alter table public.messages                enable row level security;
alter table public.subscriptions           enable row level security;

-- profiles: you see and edit your own; admins see all.
create policy "profiles: read own"   on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- coaches: a coach manages their own row. Public reads go through the
-- public_coaches view below, which hides Stripe and receptionist settings.
create policy "coaches: read own"   on public.coaches for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));
create policy "coaches: insert own" on public.coaches for insert to authenticated
  with check (profile_id = (select auth.uid()) and (select public.my_role()) = 'coach');
create policy "coaches: update own" on public.coaches for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

-- services: owner manages; anyone can read active services of published coaches.
create policy "services: public read" on public.services for select to anon, authenticated
  using ((active and public.coach_is_published(coach_id)) or coach_id = (select public.my_coach_id()) or (select public.is_admin()));
create policy "services: owner insert" on public.services for insert to authenticated
  with check (coach_id = (select public.my_coach_id()));
create policy "services: owner update" on public.services for update to authenticated
  using (coach_id = (select public.my_coach_id())) with check (coach_id = (select public.my_coach_id()));
create policy "services: owner delete" on public.services for delete to authenticated
  using (coach_id = (select public.my_coach_id()));

-- availability rules & exceptions: same pattern (public needs them to show free slots).
create policy "availability_rules: public read" on public.availability_rules for select to anon, authenticated
  using (public.coach_is_published(coach_id) or coach_id = (select public.my_coach_id()) or (select public.is_admin()));
create policy "availability_rules: owner insert" on public.availability_rules for insert to authenticated
  with check (coach_id = (select public.my_coach_id()));
create policy "availability_rules: owner update" on public.availability_rules for update to authenticated
  using (coach_id = (select public.my_coach_id())) with check (coach_id = (select public.my_coach_id()));
create policy "availability_rules: owner delete" on public.availability_rules for delete to authenticated
  using (coach_id = (select public.my_coach_id()));

create policy "availability_exceptions: public read" on public.availability_exceptions for select to anon, authenticated
  using (public.coach_is_published(coach_id) or coach_id = (select public.my_coach_id()) or (select public.is_admin()));
create policy "availability_exceptions: owner insert" on public.availability_exceptions for insert to authenticated
  with check (coach_id = (select public.my_coach_id()));
create policy "availability_exceptions: owner update" on public.availability_exceptions for update to authenticated
  using (coach_id = (select public.my_coach_id())) with check (coach_id = (select public.my_coach_id()));
create policy "availability_exceptions: owner delete" on public.availability_exceptions for delete to authenticated
  using (coach_id = (select public.my_coach_id()));

-- players: parents manage their own children; a coach can read players booked with them.
create policy "players: parent read"   on public.players for select to authenticated
  using (parent_profile_id = (select auth.uid()) or public.player_booked_with_me(id) or (select public.is_admin()));
create policy "players: parent insert" on public.players for insert to authenticated
  with check (parent_profile_id = (select auth.uid()));
create policy "players: parent update" on public.players for update to authenticated
  using (parent_profile_id = (select auth.uid())) with check (parent_profile_id = (select auth.uid()));
create policy "players: parent delete" on public.players for delete to authenticated
  using (parent_profile_id = (select auth.uid()));

-- bookings: coach sees their bookings, parent sees bookings they made.
-- Parent bookings are created server-side in Phase 2 (after payment checks);
-- coaches can add manual bookings for themselves now.
create policy "bookings: read" on public.bookings for select to authenticated
  using (coach_id = (select public.my_coach_id()) or booked_by_profile_id = (select auth.uid()) or (select public.is_admin()));
create policy "bookings: coach insert manual" on public.bookings for insert to authenticated
  with check (coach_id = (select public.my_coach_id()) and source = 'coach_manual');
create policy "bookings: coach update" on public.bookings for update to authenticated
  using (coach_id = (select public.my_coach_id())) with check (coach_id = (select public.my_coach_id()));

-- conversations & messages: coach only (the AI writes with the service role).
create policy "conversations: coach read" on public.conversations for select to authenticated
  using (coach_id = (select public.my_coach_id()) or (select public.is_admin()));
create policy "conversations: coach update" on public.conversations for update to authenticated
  using (coach_id = (select public.my_coach_id())) with check (coach_id = (select public.my_coach_id()));
create policy "messages: coach read" on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and c.coach_id = (select public.my_coach_id())) or (select public.is_admin()));
create policy "messages: coach reply" on public.messages for insert to authenticated
  with check (sender = 'coach' and exists (select 1 from public.conversations c where c.id = conversation_id and c.coach_id = (select public.my_coach_id())));

-- subscriptions: coach can read their own; only Stripe webhooks (service role) write.
create policy "subscriptions: coach read" on public.subscriptions for select to authenticated
  using (coach_id = (select public.my_coach_id()) or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Column-level privileges: stop users editing fields only the server may set
-- ---------------------------------------------------------------------------
revoke insert, update on public.profiles from anon, authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

revoke insert, update on public.coaches from anon, authenticated;
grant insert (profile_id, business_name, slug, bio, photo_url, postcode, qualifications, dbs_checked, dbs_date, published, receptionist_settings)
  on public.coaches to authenticated;
grant update (business_name, slug, bio, photo_url, postcode, qualifications, dbs_checked, dbs_date, published, receptionist_settings)
  on public.coaches to authenticated;

revoke update on public.bookings from anon, authenticated;
grant update (status, start_at, end_at) on public.bookings to authenticated;

revoke update on public.conversations from anon, authenticated;
grant update (needs_handoff) on public.conversations to authenticated;

revoke insert, update, delete on public.subscriptions from anon, authenticated;

-- Nothing is writable by anonymous visitors.
revoke insert, update, delete on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Public view for the booking page (/[slug]). Only safe columns, only published coaches.
-- Runs with the view owner's rights, so it can read coaches without exposing the table.
-- ---------------------------------------------------------------------------
create view public.public_coaches as
  select id, business_name, slug, bio, photo_url, postcode, qualifications, dbs_checked, dbs_date
  from public.coaches
  where published;

grant select on public.public_coaches to anon, authenticated;
