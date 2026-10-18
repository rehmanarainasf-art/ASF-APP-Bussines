
do $$ begin create type public.app_role as enum ('admin','user'); exception when duplicate_object then null; end $$;

create or replace function public.asf_generate_number() returns text language plpgsql volatile set search_path=public as $$
begin return '+923' || lpad((floor(random()*1000000000))::bigint::text, 9, '0'); end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  asf_number text not null unique default public.asf_generate_number(),
  display_name text not null default '',
  about text not null default '',
  avatar_url text,
  business jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, role public.app_role not null, unique(user_id, role));
create table if not exists public.messenger_state (user_id uuid primary key references public.profiles(id) on delete cascade, data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.ai_threads (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, title text not null default 'New conversation', messages jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.ai_access_state (user_id uuid primary key references public.profiles(id) on delete cascade, blocked boolean not null default false, reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.contacts (id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade, asf_number text not null, name text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id, asf_number));
create table if not exists public.direct_chats (id uuid primary key default gen_random_uuid(), user_a uuid not null references public.profiles(id) on delete cascade, user_b uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_a, user_b));
create table if not exists public.direct_messages (id uuid primary key default gen_random_uuid(), chat_id uuid not null references public.direct_chats(id) on delete cascade, sender_id uuid not null references public.profiles(id) on delete cascade, body text not null default '', deleted boolean not null default false, delivered_at timestamptz, read_at timestamptz, media_name text, media_path text, media_type text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists direct_messages_chat_created on public.direct_messages(chat_id, created_at desc);
create table if not exists public.message_reports (id uuid primary key default gen_random_uuid(), message_id uuid not null references public.direct_messages(id) on delete cascade, reporter_id uuid not null references public.profiles(id) on delete cascade, reason text not null, moderation_note text not null default '', status text not null default 'open', reviewed_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.call_signals (id uuid primary key default gen_random_uuid(), call_id text not null, from_id uuid not null references public.profiles(id) on delete cascade, to_id uuid not null references public.profiles(id) on delete cascade, kind text not null, payload jsonb not null default '{}'::jsonb, video boolean not null default false, created_at timestamptz not null default now());
create table if not exists public.push_tokens (token text primary key, user_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.statuses (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, body text not null default '', color text not null default '#075e54', media_path text, media_type text, created_at timestamptz not null default now(), expires_at timestamptz not null default (now() + interval '24 hours'));
create table if not exists public.status_receipts (status_id uuid not null references public.statuses(id) on delete cascade, viewer_id uuid not null references public.profiles(id) on delete cascade, liked boolean not null default false, viewed_at timestamptz not null default now(), primary key(status_id, viewer_id));
create table if not exists public.admin_audit (id uuid primary key default gen_random_uuid(), admin_id uuid not null, action text not null, target_user uuid, ref text, reason text, ok boolean not null default true, created_at timestamptz not null default now());

grant select, insert, update, delete on public.profiles, public.messenger_state, public.ai_threads, public.contacts, public.direct_chats, public.direct_messages, public.call_signals, public.push_tokens, public.statuses, public.status_receipts to authenticated;
grant select, insert on public.message_reports to authenticated;
grant select on public.user_roles, public.ai_access_state, public.admin_audit to authenticated;
grant all on all tables in schema public to service_role;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.messenger_state enable row level security;
alter table public.ai_threads enable row level security;
alter table public.ai_access_state enable row level security;
alter table public.contacts enable row level security;
alter table public.direct_chats enable row level security;
alter table public.direct_messages enable row level security;
alter table public.message_reports enable row level security;
alter table public.call_signals enable row level security;
alter table public.push_tokens enable row level security;
alter table public.statuses enable row level security;
alter table public.status_receipts enable row level security;
alter table public.admin_audit enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.user_roles where user_id=_user_id and role=_role) $$;
create or replace function public.is_chat_member(_chat uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.direct_chats where id=_chat and auth.uid() in (user_a,user_b)) $$;
create or replace function public.are_chat_partners(_a uuid, _b uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.direct_chats where (user_a=_a and user_b=_b) or (user_a=_b and user_b=_a)) $$;
create or replace function public.can_see_status(_owner uuid) returns boolean language sql stable security definer set search_path=public as $$
  select _owner = auth.uid() or public.are_chat_partners(_owner, auth.uid())
    or exists (select 1 from public.contacts c join public.profiles p on p.asf_number = c.asf_number where p.id=_owner and c.owner_id=auth.uid()) $$;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "own roles" on public.user_roles;
create policy "own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());
drop policy if exists "own state" on public.messenger_state;
create policy "own state" on public.messenger_state for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own threads" on public.ai_threads;
create policy "own threads" on public.ai_threads for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own ai access" on public.ai_access_state;
create policy "own ai access" on public.ai_access_state for select to authenticated using (user_id = auth.uid());
drop policy if exists "own contacts" on public.contacts;
create policy "own contacts" on public.contacts for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "member chats" on public.direct_chats;
create policy "member chats" on public.direct_chats for select to authenticated using (auth.uid() in (user_a,user_b));
drop policy if exists "member chats update" on public.direct_chats;
create policy "member chats update" on public.direct_chats for update to authenticated using (auth.uid() in (user_a,user_b));
drop policy if exists "member msgs read" on public.direct_messages;
create policy "member msgs read" on public.direct_messages for select to authenticated using (public.is_chat_member(chat_id));
drop policy if exists "member msgs send" on public.direct_messages;
create policy "member msgs send" on public.direct_messages for insert to authenticated with check (sender_id = auth.uid() and public.is_chat_member(chat_id));
drop policy if exists "member msgs update" on public.direct_messages;
create policy "member msgs update" on public.direct_messages for update to authenticated using (public.is_chat_member(chat_id));
drop policy if exists "own msgs delete" on public.direct_messages;
create policy "own msgs delete" on public.direct_messages for delete to authenticated using (sender_id = auth.uid());
drop policy if exists "report insert" on public.message_reports;
create policy "report insert" on public.message_reports for insert to authenticated with check (reporter_id = auth.uid() and exists (select 1 from public.direct_messages m where m.id = message_id and public.is_chat_member(m.chat_id)));
drop policy if exists "report read own" on public.message_reports;
create policy "report read own" on public.message_reports for select to authenticated using (reporter_id = auth.uid() or public.has_role(auth.uid(),'admin'));
drop policy if exists "signals read" on public.call_signals;
create policy "signals read" on public.call_signals for select to authenticated using (auth.uid() in (from_id,to_id));
drop policy if exists "signals send" on public.call_signals;
create policy "signals send" on public.call_signals for insert to authenticated with check (from_id = auth.uid() and public.are_chat_partners(from_id,to_id));
drop policy if exists "signals delete" on public.call_signals;
create policy "signals delete" on public.call_signals for delete to authenticated using (auth.uid() in (from_id,to_id));
drop policy if exists "own push" on public.push_tokens;
create policy "own push" on public.push_tokens for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "status read" on public.statuses;
create policy "status read" on public.statuses for select to authenticated using (user_id = auth.uid() or (expires_at > now() and public.can_see_status(user_id)));
drop policy if exists "status own write" on public.statuses;
create policy "status own write" on public.statuses for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "status own delete" on public.statuses;
create policy "status own delete" on public.statuses for delete to authenticated using (user_id = auth.uid());
drop policy if exists "receipt own" on public.status_receipts;
create policy "receipt own" on public.status_receipts for all to authenticated using (viewer_id = auth.uid()) with check (viewer_id = auth.uid());
drop policy if exists "audit admin read" on public.admin_audit;
create policy "audit admin read" on public.admin_audit for select to authenticated using (public.has_role(auth.uid(),'admin'));

drop function if exists public.asf_caller_profile(uuid);
create function public.asf_caller_profile(_id uuid) returns table(display_name text, asf_number text, avatar_url text) language sql stable security definer set search_path=public as $$
  select p.display_name, p.asf_number, p.avatar_url from public.profiles p where p.id=_id and public.are_chat_partners(_id, auth.uid()) $$;
drop function if exists public.asf_status_viewers(uuid);
create function public.asf_status_viewers(_status_id uuid) returns table(viewer_id uuid, display_name text, asf_number text, avatar_url text, liked boolean, viewed_at timestamptz) language sql stable security definer set search_path=public as $$
  select r.viewer_id, p.display_name, p.asf_number, p.avatar_url, r.liked, r.viewed_at from public.status_receipts r join public.profiles p on p.id=r.viewer_id
  join public.statuses s on s.id=r.status_id where r.status_id=_status_id and s.user_id=auth.uid() order by r.liked desc, r.viewed_at desc $$;

create or replace function public.touch_chat() returns trigger language plpgsql security definer set search_path=public as $$
begin update public.direct_chats set updated_at=now() where id=new.chat_id; return new; end $$;
drop trigger if exists direct_messages_touch on public.direct_messages;
create trigger direct_messages_touch after insert on public.direct_messages for each row execute function public.touch_chat();

alter table public.direct_messages replica identity full;
do $$ begin alter publication supabase_realtime add table public.direct_messages, public.direct_chats, public.statuses, public.call_signals; exception when duplicate_object then null; end $$;

drop policy if exists "asf media read" on storage.objects;
create policy "asf media read" on storage.objects for select to authenticated using (bucket_id='asf-media');
drop policy if exists "asf media upload" on storage.objects;
create policy "asf media upload" on storage.objects for insert to authenticated with check (bucket_id='asf-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "asf media delete" on storage.objects;
create policy "asf media delete" on storage.objects for delete to authenticated using (bucket_id='asf-media' and (storage.foldername(name))[1] = auth.uid()::text);
