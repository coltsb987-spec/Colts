-- Explicit table privileges.
-- Newer Supabase projects no longer grant anon/authenticated/service_role access to new
-- tables automatically. Instead of relying on defaults, every privilege is listed here.
-- Row-level security (migration 1) still decides WHICH rows each user can touch;
-- these grants decide WHICH tables/columns each role may use at all.

grant usage on schema public to anon, authenticated, service_role;

-- Start from nothing for the API roles, then grant precisely.
revoke all on all tables in schema public from anon, authenticated;

-- Server-side code (Stripe webhooks, AI receptionist) uses the secret key.
grant all on all tables in schema public to service_role;

-- Anonymous visitors: only what the public booking page needs.
grant select on public.public_coaches, public.services, public.availability_rules, public.availability_exceptions to anon;

-- Signed-in users (coaches and parents).
grant select on public.public_coaches to authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

grant select on public.coaches to authenticated;
grant insert (profile_id, business_name, slug, bio, photo_url, postcode, qualifications, dbs_checked, dbs_date, published, receptionist_settings)
  on public.coaches to authenticated;
grant update (business_name, slug, bio, photo_url, postcode, qualifications, dbs_checked, dbs_date, published, receptionist_settings)
  on public.coaches to authenticated;

grant select, insert, update, delete on public.services, public.availability_rules, public.availability_exceptions, public.players
  to authenticated;

grant select, insert on public.bookings to authenticated;
grant update (status, start_at, end_at) on public.bookings to authenticated;

grant select on public.conversations to authenticated;
grant update (needs_handoff) on public.conversations to authenticated;

grant select, insert on public.messages to authenticated;

grant select on public.subscriptions to authenticated;

-- Helper functions used inside RLS policies.
grant execute on function public.is_admin(), public.my_coach_id(), public.my_role(),
  public.coach_is_published(uuid), public.player_booked_with_me(uuid)
  to anon, authenticated, service_role;
revoke execute on function public.handle_new_user() from anon, authenticated;
