-- Call log for the admin console, admin role, and per-project discounts.

alter table profiles add column is_admin boolean not null default false;
alter table sites add column discount_percent int not null default 0 check (discount_percent between 0 and 90);

create table calls (
  id text primary key,                       -- Vapi call id
  business_id uuid references businesses(id),
  caller_phone text,
  type text,                                 -- inboundPhoneCall | webCall | ...
  status text not null default 'in-progress',
  ended_reason text,
  summary text,
  recording_url text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table call_events (
  id bigint generated always as identity primary key,
  call_id text not null references calls(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('transcript', 'tool_call', 'tool_result', 'status')),
  role text,                                 -- user | assistant, for transcripts
  text text,
  data jsonb
);
create index call_events_call_idx on call_events (call_id, at);
create index calls_started_idx on calls (started_at desc);

-- Which call an action or a landing page build came from.
alter table actions add column call_id text;
alter table site_builds add column call_id text;
create index actions_call_idx on actions (call_id);

create function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;
revoke execute on function is_admin() from public, anon;
grant execute on function is_admin() to authenticated, service_role;

alter table calls enable row level security;
alter table call_events enable row level security;
revoke all on calls, call_events from anon;
revoke all on calls, call_events from authenticated;
grant select on calls, call_events to authenticated;

-- Admins see every call; an owner sees calls about their own business.
create policy "admin or owner reads calls" on calls
  for select to authenticated
  using (is_admin() or business_id in (select id from businesses where owner_id = (select auth.uid())));

create policy "admin or owner reads call events" on call_events
  for select to authenticated
  using (call_id in (select id from calls));

create policy "admin reads all actions" on actions
  for select to authenticated using (is_admin());

create policy "admin reads all site builds" on site_builds
  for select to authenticated using (is_admin());

alter publication supabase_realtime add table calls, call_events;
