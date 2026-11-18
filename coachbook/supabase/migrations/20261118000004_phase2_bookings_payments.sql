-- Phase 2: bookings, payments, subscriptions.
--  * Double-booking is prevented by an exclusion constraint in the database.
--  * Bookings are only created/changed by the server (secret key) through the
--    functions below, after availability and payment checks.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Coaches: booking notice + Stripe state (Stripe fields are server-only)
-- ---------------------------------------------------------------------------
alter table public.coaches
  add column booking_notice_hours integer not null default 12 check (booking_notice_hours between 0 and 168),
  add column stripe_charges_enabled boolean not null default false,
  add column stripe_customer_id text;

grant insert (booking_notice_hours), update (booking_notice_hours) on public.coaches to authenticated;

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column price_pence integer not null default 0 check (price_pence >= 0),
  add column platform_fee_pence integer not null default 0 check (platform_fee_pence >= 0),
  -- Bookings that may share a time slot share a slot_key (same group session).
  -- A 1-to-1 booking gets a unique key, so nothing can overlap it.
  add column slot_key text not null default gen_random_uuid()::text,
  add column hold_expires_at timestamptz,          -- unpaid bookings release the slot after this
  add column stripe_checkout_session_id text unique,
  add column cancelled_at timestamptz,
  add column cancelled_by text check (cancelled_by in ('coach', 'parent', 'system')),
  add column reminder_sent_at timestamptz;

-- A coach can never have two different active sessions overlapping in time.
alter table public.bookings
  add constraint bookings_no_double_booking
  exclude using gist (
    coach_id with =,
    tstzrange(start_at, end_at, '[)') with &&,
    slot_key with <>
  ) where (status in ('pending', 'confirmed'));

create index bookings_slot_key_idx on public.bookings (slot_key) where status in ('pending', 'confirmed');

-- Deleting one session type that has bookings is still blocked, but deleting a whole
-- coach account (which removes their sessions and bookings together) now works.
alter table public.bookings drop constraint bookings_service_id_fkey;
alter table public.bookings add constraint bookings_service_id_fkey
  foreign key (service_id) references public.services (id) on delete no action;

-- All booking changes now go through the server (refunds, emails, checks).
revoke update on public.bookings from authenticated;
drop policy if exists "bookings: coach update" on public.bookings;

-- ---------------------------------------------------------------------------
-- Stripe webhook idempotency
-- ---------------------------------------------------------------------------
create table public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;  -- no policies: server only
grant all on public.stripe_events to service_role;

-- ---------------------------------------------------------------------------
-- Booking functions (server only)
-- ---------------------------------------------------------------------------
create or replace function public.slot_key_for(p_service_id uuid, p_start timestamptz, p_type public.service_type)
returns text language sql volatile set search_path = '' as $$
  select case when p_type = 'one_to_one' then gen_random_uuid()::text
              else p_service_id::text || '@' || to_char(p_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end;
$$;

-- Creates a booking for a slot. Raises 'slot_full' for a full group session;
-- an overlapping booking raises exclusion_violation (23P01).
create or replace function public.book_slot(
  p_service_id      uuid,
  p_start           timestamptz,
  p_player_id       uuid,
  p_booked_by       uuid,
  p_source          public.booking_source,
  p_status          public.booking_status,
  p_hold_minutes    integer,
  p_platform_fee    integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s        public.services%rowtype;
  v_key    text;
  v_taken  integer;
  v_id     uuid;
begin
  select * into s from public.services where id = p_service_id and active;
  if not found then raise exception 'service_unavailable'; end if;

  -- One booking at a time per coach (prevents group over-filling).
  perform 1 from public.coaches where id = s.coach_id for update;

  -- Release expired unpaid holds for this coach.
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'system'
   where coach_id = s.coach_id and status = 'pending' and hold_expires_at < now();

  v_key := public.slot_key_for(s.id, p_start, s.type);
  if s.type <> 'one_to_one' then
    select count(*) into v_taken from public.bookings
     where slot_key = v_key and status in ('pending', 'confirmed');
    if v_taken >= s.max_participants then raise exception 'slot_full'; end if;
  end if;

  insert into public.bookings (coach_id, service_id, player_id, booked_by_profile_id, start_at, end_at,
                               status, payment_status, source, price_pence, platform_fee_pence, slot_key, hold_expires_at)
  values (s.coach_id, s.id, p_player_id, p_booked_by, p_start, p_start + make_interval(mins => s.duration_minutes),
          p_status, 'unpaid', p_source, s.price_pence, coalesce(p_platform_fee, 0), v_key,
          case when p_status = 'pending' then now() + make_interval(mins => p_hold_minutes) end)
  returning id into v_id;
  return v_id;
end;
$$;

-- Moves a booking to a new start time (same service). Same checks as book_slot.
create or replace function public.reschedule_booking(p_booking_id uuid, p_new_start timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b       public.bookings%rowtype;
  s       public.services%rowtype;
  v_key   text;
  v_taken integer;
begin
  select * into b from public.bookings where id = p_booking_id;
  if not found or b.status not in ('pending', 'confirmed') then raise exception 'booking_not_active'; end if;
  select * into s from public.services where id = b.service_id;
  perform 1 from public.coaches where id = b.coach_id for update;

  v_key := public.slot_key_for(s.id, p_new_start, s.type);
  if s.type <> 'one_to_one' then
    select count(*) into v_taken from public.bookings
     where slot_key = v_key and status in ('pending', 'confirmed') and id <> b.id;
    if v_taken >= s.max_participants then raise exception 'slot_full'; end if;
  end if;

  update public.bookings
     set start_at = p_new_start,
         end_at = p_new_start + make_interval(mins => s.duration_minutes),
         slot_key = v_key,
         reminder_sent_at = null
   where id = b.id;
end;
$$;

revoke execute on function public.slot_key_for(uuid, timestamptz, public.service_type) from public, anon, authenticated;
revoke execute on function public.book_slot(uuid, timestamptz, uuid, uuid, public.booking_source, public.booking_status, integer, integer) from public, anon, authenticated;
revoke execute on function public.reschedule_booking(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.slot_key_for(uuid, timestamptz, public.service_type) to service_role;
grant execute on function public.book_slot(uuid, timestamptz, uuid, uuid, public.booking_source, public.booking_status, integer, integer) to service_role;
grant execute on function public.reschedule_booking(uuid, timestamptz) to service_role;
