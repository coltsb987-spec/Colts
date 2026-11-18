-- RLS tests. Run with: npm run test:db  (see scripts/test-db.sh)
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', label; end if;
  raise notice 'ok - %', label;
end $$;
-- Expect a statement to be refused (permission or RLS error)
create or replace function pg_temp.refused(stmt text, label text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when insufficient_privilege or check_violation or others then
    raise notice 'ok - % (refused: %)', label, sqlerrm; return; end;
  raise exception 'FAIL: % was allowed', label;
end $$;

-- Users: coach A, coach B, parent P, parent Q, someone trying to sign up as admin
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a','a@x.uk','{"role":"coach","full_name":"Coach A"}'),
 ('00000000-0000-0000-0000-00000000000b','b@x.uk','{"role":"coach"}'),
 ('00000000-0000-0000-0000-00000000000c','p@x.uk','{"role":"parent"}'),
 ('00000000-0000-0000-0000-00000000000d','q@x.uk','{}'),
 ('00000000-0000-0000-0000-00000000000e','e@x.uk','{"role":"admin"}');
select pg_temp.check((select role from profiles where id='00000000-0000-0000-0000-00000000000e')='parent', 'cannot sign up as admin');
select pg_temp.check((select count(*) from profiles)=5, 'profile created per user');

-- ===== Coach A =====
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into coaches (profile_id, business_name, slug, published) values ('00000000-0000-0000-0000-00000000000a','A Football','a-football', true);
insert into services (coach_id, name, type, duration_minutes, price_pence) select my_coach_id(), '1-to-1', 'one_to_one', 60, 3500;
insert into availability_rules (coach_id, weekday, start_time, end_time) select my_coach_id(), 1, '16:00', '19:00';
select pg_temp.refused($$update coaches set subscription_status='active'$$, 'coach cannot set own subscription_status');
select pg_temp.refused($$update coaches set stripe_account_id='acct_x'$$, 'coach cannot set own stripe_account_id');
select pg_temp.refused($$update profiles set role='admin'$$, 'user cannot change own role');
select pg_temp.refused($$insert into coaches (profile_id, business_name, slug) values ('00000000-0000-0000-0000-00000000000b','Fake','fake-coach')$$, 'cannot create coach for someone else');
select pg_temp.refused($$insert into coaches (profile_id, business_name, slug) values ('00000000-0000-0000-0000-00000000000a','Dup','login')$$, 'reserved slug rejected');

-- ===== Coach B (unpublished) =====
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into coaches (profile_id, business_name, slug) values ('00000000-0000-0000-0000-00000000000b','B Coaching','b-coaching');
insert into services (coach_id, name, type, duration_minutes, price_pence) select my_coach_id(), 'B group', 'group', 60, 1000;
select pg_temp.check((select count(*) from coaches)=1, 'coach B sees only own coach row');
select pg_temp.check((select count(*) from services where coach_id <> my_coach_id())=1, 'coach B sees A''s public services');
select pg_temp.check((select count(*) from coaches where slug='a-football')=0, 'coach B cannot read A''s private coach row');
update services set price_pence = 1 where coach_id <> my_coach_id();
select pg_temp.check((select price_pence from services where name='1-to-1')=3500, 'coach B cannot edit A''s services');
delete from availability_rules;
reset role;
select pg_temp.check((select count(*) from availability_rules)=1, 'coach B cannot delete A''s availability');

-- ===== Parent P =====
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.refused($$insert into coaches (profile_id, business_name, slug) values ('00000000-0000-0000-0000-00000000000c','Parent Co','parent-co')$$, 'parent cannot create coach profile');
insert into players (parent_profile_id, first_name, age_group) values ('00000000-0000-0000-0000-00000000000c','Sam','U10');
select pg_temp.refused($$insert into players (parent_profile_id, first_name, age_group) values ('00000000-0000-0000-0000-00000000000d','X','U9')$$, 'parent cannot add player to another parent');
select pg_temp.refused($$insert into bookings (coach_id, service_id, start_at, end_at) select id, (select id from services limit 1), now(), now()+interval '1h' from public_coaches$$, 'parent cannot insert booking directly');
select pg_temp.check((select count(*) from public_coaches)=1, 'public view shows only published coaches');
reset role;
-- server (service role) creates a booking for P with coach A
insert into bookings (coach_id, service_id, player_id, booked_by_profile_id, start_at, end_at, source)
  select c.id, s.id, p.id, '00000000-0000-0000-0000-00000000000c', '2026-12-07 16:00+00', '2026-12-07 17:00+00', 'web'
  from coaches c join services s on s.coach_id=c.id, players p where c.slug='a-football';
insert into conversations (coach_id, contact_name) select id, 'Enquirer' from coaches where slug='a-football';
insert into messages (conversation_id, sender, content) select id, 'customer', 'Hi' from conversations;

set role authenticated;
select pg_temp.check((select count(*) from bookings)=1, 'parent P sees own booking');
select pg_temp.check((select count(*) from conversations)=0, 'parent cannot read coach conversations');
select pg_temp.refused($$update bookings set payment_status='paid'$$, 'parent cannot mark booking paid');

-- ===== Parent Q =====
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.check((select count(*) from bookings)=0, 'parent Q cannot see P''s booking');
select pg_temp.check((select count(*) from players)=0, 'parent Q cannot see P''s child');

-- ===== Coach A again =====
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check((select count(*) from bookings)=1, 'coach A sees booking with them');
select pg_temp.check((select count(*) from players)=1, 'coach A sees booked player');
select pg_temp.check((select count(*) from messages)=1, 'coach A reads own conversation');
select pg_temp.refused($$insert into messages (conversation_id, sender, content) select id, 'ai', 'pretend AI' from conversations$$, 'coach cannot post as AI');
select pg_temp.refused($$insert into subscriptions (coach_id, plan, status) values (my_coach_id(),'pro','active')$$, 'coach cannot create subscription');

-- ===== Coach B again =====
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from bookings)=0, 'coach B cannot see A''s bookings');
select pg_temp.check((select count(*) from players)=0, 'coach B cannot see A''s players');
select pg_temp.check((select count(*) from messages)=0, 'coach B cannot see A''s messages');

-- ===== Anonymous visitor =====
reset request.jwt.claim.sub;
set role anon;
select pg_temp.check((select count(*) from public_coaches)=1, 'anon sees published coach via view');
select pg_temp.check((select count(*) from services)=1, 'anon sees only published coach services');
select pg_temp.check((select count(*) from coaches)=0, 'anon gets no rows from coaches table');
select pg_temp.check((select count(*) from players)=0, 'anon gets no rows from players');
select pg_temp.check((select count(*) from bookings)=0, 'anon gets no rows from bookings');
select pg_temp.refused($$insert into services (coach_id, name, type, duration_minutes, price_pence) select id,'x','group',60,1 from public_coaches$$, 'anon cannot insert');
reset role;
\echo 'ALL RLS TESTS PASSED'
