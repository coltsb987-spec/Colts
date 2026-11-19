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
select pg_temp.refused($$select * from coaches$$, 'anon cannot read coaches table');
select pg_temp.refused($$select * from players$$, 'anon cannot read players');
select pg_temp.refused($$select * from bookings$$, 'anon cannot read bookings');
select pg_temp.refused($$select * from messages$$, 'anon cannot read messages');
select pg_temp.refused($$insert into services (coach_id, name, type, duration_minutes, price_pence) select id,'x','group',60,1 from public_coaches$$, 'anon cannot insert');
reset role;
set role service_role;
select pg_temp.check((select count(*) from bookings)=1, 'server (secret key) can read bookings');
reset role;

-- ===== Phase 2: double-booking protection =====
-- coach A: 1-to-1 '1-to-1' (60 min) already booked 2026-12-07 16:00-17:00 UTC
select pg_temp.refused($$select book_slot((select id from services where name='1-to-1'), '2026-12-07 16:30+00', null, null, 'web', 'pending', 30, 0)$$,
  'overlapping 1-to-1 booking rejected by database');
select pg_temp.check(book_slot((select id from services where name='1-to-1'), '2026-12-07 17:00+00', null, null, 'web', 'pending', 30, 0) is not null,
  'back-to-back booking allowed');
-- group session, capacity 2
insert into services (coach_id, name, type, duration_minutes, price_pence, max_participants)
  select id, 'A group', 'group', 60, 1000, 2 from coaches where slug='a-football';
select book_slot((select id from services where name='A group'), '2026-12-08 16:00+00', null, null, 'web', 'confirmed', 30, 0);
select book_slot((select id from services where name='A group'), '2026-12-08 16:00+00', null, null, 'web', 'confirmed', 30, 0);
select pg_temp.check((select count(*) from bookings where slot_key like '%@2026-12-08T16:00:00Z')=2, 'two players share one group session');
select pg_temp.refused($$select book_slot((select id from services where name='A group'), '2026-12-08 16:00+00', null, null, 'web', 'confirmed', 30, 0)$$,
  'third player rejected when group is full');
select pg_temp.refused($$select book_slot((select id from services where name='1-to-1'), '2026-12-08 16:30+00', null, null, 'web', 'pending', 30, 0)$$,
  '1-to-1 cannot overlap a group session');
-- expired hold frees the slot
update bookings set hold_expires_at = now() - interval '1 minute' where start_at = '2026-12-07 17:00+00';
select pg_temp.check(book_slot((select id from services where name='1-to-1'), '2026-12-07 17:00+00', null, null, 'web', 'pending', 30, 0) is not null,
  'expired unpaid hold releases the slot');
-- reschedule into a clash is rejected; into a free time works
select pg_temp.refused($$select reschedule_booking((select id from bookings where start_at='2026-12-07 16:00+00' and status='pending' limit 1), '2026-12-07 17:30+00')$$,
  'reschedule into a clash rejected');
select reschedule_booking((select id from bookings where start_at='2026-12-07 16:00+00' and status='pending' limit 1), '2026-12-09 10:00+00');
select pg_temp.check((select count(*) from bookings where start_at='2026-12-09 10:00+00')=1, 'reschedule to a free time works');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.refused($$update bookings set status='cancelled'$$, 'coach cannot change bookings directly (server does refunds)');
select pg_temp.refused($$select book_slot((select id from services where name='1-to-1'), '2026-12-20 10:00+00', null, null, 'web', 'confirmed', 30, 0)$$,
  'signed-in users cannot call book_slot');
select pg_temp.refused($$update coaches set stripe_charges_enabled = true$$, 'coach cannot mark own Stripe as enabled');
update coaches set booking_notice_hours = 24;
select pg_temp.check((select booking_notice_hours from coaches)=24, 'coach can set booking notice');
set role anon;
select pg_temp.refused($$select * from stripe_events$$, 'anon cannot read stripe events');
reset role;
-- ===== Phase 3: receptionist conversations =====
update conversations set visitor_token_hash = 'abc', ip_hash = 'iphash';
select id as conv_id from conversations limit 1 \gset
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update conversations set needs_handoff = true, coach_read_at = now();
select pg_temp.check((select needs_handoff from conversations limit 1), 'coach can flag/mark their conversation');
select pg_temp.refused($$update conversations set visitor_token_hash = 'x'$$, 'coach cannot change the visitor token');
select pg_temp.refused($$insert into conversations (coach_id) select my_coach_id()$$, 'coach cannot create conversations directly');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from conversations)=0, 'other coach cannot see the conversation');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.check((select count(*) from conversations)=0, 'parent cannot read conversations');
select pg_temp.refused(format($$insert into messages (conversation_id, sender, content) values (%L, 'customer', 'x')$$, :'conv_id'), 'parent cannot write chat messages directly');
select pg_temp.refused(format($$insert into messages (conversation_id, sender, content) values (%L, 'coach', 'x')$$, :'conv_id'), 'parent cannot post as the coach');
set role anon;
select pg_temp.refused($$select * from conversations$$, 'anon cannot read conversations');
reset role;

select pg_temp.refused($$delete from services where name='1-to-1'$$, 'session type with bookings cannot be deleted');
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check((select count(*) from coaches where slug='a-football')=0, 'deleting a coach account removes their data');
\echo 'ALL RLS TESTS PASSED'
