-- Stage 1: workspaces, membership, businesses and (empty) call records.
-- Every table has row level security (RLS) enabled. The browser only ever holds
-- the public anon/publishable key, so these policies are what keeps one
-- workspace's data away from another.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);

create type public.workspace_role as enum ('owner', 'admin', 'member');

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);

create type public.business_status as enum ('setup_needed', 'active', 'paused');

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  business_type text not null check (char_length(business_type) between 1 and 60),
  status public.business_status not null default 'setup_needed',
  -- Only set once a real number has been provisioned with a telephony provider.
  phone_number text check (phone_number is null or phone_number ~ '^\+44[0-9]{9,10}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index businesses_workspace_id_idx on public.businesses (workspace_id);

create type public.call_outcome as enum ('answered', 'lead_captured', 'booking_requested', 'transferred', 'missed');

-- Written later by the server-side telephony integration (service role only).
-- Nothing is seeded: the dashboard shows real records or nothing.
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  business_id uuid not null,
  started_at timestamptz not null,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  outcome public.call_outcome not null,
  summary text check (summary is null or char_length(summary) <= 2000),
  is_test boolean not null default true,
  created_at timestamptz not null default now(),
  -- A call's business must live in the same workspace as the call.
  foreign key (business_id, workspace_id) references public.businesses (id, workspace_id) on delete cascade
);

create index calls_workspace_started_idx on public.calls (workspace_id, started_at desc);
create index calls_business_id_idx on public.calls (business_id);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------

create schema if not exists private;

create function private.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace
      and m.user_id = (select auth.uid())
  );
$$;

create function private.has_workspace_role(target_workspace uuid, roles public.workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace
      and m.user_id = (select auth.uid())
      and m.role = any (roles)
  );
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.has_workspace_role(uuid, public.workspace_role[]) to authenticated;

-- Give every new account its own workspace with the user as owner.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace uuid;
begin
  insert into public.workspaces (name) values ('My workspace') returning id into new_workspace;
  insert into public.workspace_members (workspace_id, user_id, role) values (new_workspace, new.id, 'owner');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger businesses_touch_updated_at
  before update on public.businesses
  for each row execute function private.touch_updated_at();

-- Stop a business from being moved to another workspace or re-attributed.
create function private.lock_business_ownership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id <> old.workspace_id or new.created_by is distinct from old.created_by then
    raise exception 'workspace_id and created_by cannot be changed';
  end if;
  return new;
end;
$$;

create trigger businesses_lock_ownership
  before update on public.businesses
  for each row execute function private.lock_business_ownership();

-- ---------------------------------------------------------------------------
-- Privileges: signed-out visitors (anon) get nothing.
-- ---------------------------------------------------------------------------

revoke all on public.workspaces, public.workspace_members, public.businesses, public.calls from anon;
revoke all on public.workspaces, public.workspace_members, public.businesses, public.calls from authenticated;

grant select, update (name) on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select, delete on public.businesses to authenticated;
grant insert (workspace_id, name, business_type, created_by) on public.businesses to authenticated;
grant update (name, business_type) on public.businesses to authenticated;
grant select on public.calls to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.businesses enable row level security;
alter table public.calls enable row level security;

create policy "Members can view their workspaces"
  on public.workspaces for select to authenticated
  using ((select private.is_workspace_member(id)));

create policy "Owners and admins can rename workspaces"
  on public.workspaces for update to authenticated
  using ((select private.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[])))
  with check ((select private.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[])));

create policy "Members can view fellow members"
  on public.workspace_members for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create policy "Members can view businesses"
  on public.businesses for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create policy "Members can add businesses as themselves"
  on public.businesses for insert to authenticated
  with check (
    (select private.is_workspace_member(workspace_id))
    and created_by = (select auth.uid())
  );

create policy "Members can edit businesses"
  on public.businesses for update to authenticated
  using ((select private.is_workspace_member(workspace_id)))
  with check ((select private.is_workspace_member(workspace_id)));

create policy "Owners and admins can delete businesses"
  on public.businesses for delete to authenticated
  using ((select private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])));

create policy "Members can view calls"
  on public.calls for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- Dashboard summary. Runs as the caller (security invoker), so RLS still applies:
-- a non-member just gets zeros.
-- ---------------------------------------------------------------------------

create function public.workspace_call_stats(target_workspace uuid)
returns table (
  total_calls bigint,
  leads_captured bigint,
  booking_requests bigint,
  avg_duration_seconds integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*),
    count(*) filter (where c.outcome = 'lead_captured'),
    count(*) filter (where c.outcome = 'booking_requested'),
    coalesce(round(avg(c.duration_seconds))::integer, 0)
  from public.calls c
  where c.workspace_id = target_workspace;
$$;

revoke all on function public.workspace_call_stats(uuid) from public, anon;
grant execute on function public.workspace_call_stats(uuid) to authenticated;
