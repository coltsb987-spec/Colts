-- Phase 3: AI receptionist.
-- Chats come from anonymous web visitors, so conversations are written only by the
-- server (secret key). Each visitor proves which conversation is theirs with a random
-- token; only its hash is stored here.

alter table public.conversations
  add column contact_email      text check (char_length(contact_email) <= 254),
  add column parent_profile_id  uuid references public.profiles (id) on delete set null,
  add column visitor_token_hash text,
  add column ip_hash            text,
  add column handoff_reason     text check (char_length(handoff_reason) <= 500),
  add column last_message_at    timestamptz not null default now(),
  add column coach_read_at      timestamptz;

create index conversations_coach_last_idx on public.conversations (coach_id, last_message_at desc);
create index conversations_ip_idx on public.conversations (ip_hash, created_at);
create index messages_created_idx on public.messages (created_at);

-- Coaches may mark conversations as handled / read (replies go through the server).
grant update (needs_handoff, coach_read_at) on public.conversations to authenticated;
