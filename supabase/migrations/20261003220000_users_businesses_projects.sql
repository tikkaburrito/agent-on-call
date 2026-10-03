-- Users -> businesses -> projects.
--   profiles    one row per auth user: username, name, caller-ID phone
--   businesses  owned by a user (one per user for now, more later)
--   sites       the projects under a business: one offer, one landing page,
--               its own customers, orders and actions
-- The agent now recognises the caller by profiles.phone.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,24}$'),
  full_name text,
  phone text unique,                      -- E.164, caller ID lookup
  created_at timestamptz default now()
);

create table businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  name text not null,
  created_at timestamptz default now()
);
create index businesses_owner_idx on businesses (owner_id);

alter table sites
  add column business_id uuid references businesses(id),
  add column headline text,
  add column subhead text;

-- Backfill: each existing site becomes the first project of its own business.
insert into businesses (id, name, owner_id) select id, name, owner_id from sites;
update sites set business_id = id;
alter table sites alter column business_id set not null;
create index sites_business_idx on sites (business_id, created_at);

-- Ownership now lives on businesses.
drop policy "owner reads own site" on sites;
drop policy "owner reads own customers" on customers;
drop policy "owner reads own orders" on orders;
drop policy "owner reads own actions" on actions;
drop policy "owner reads own site builds" on site_builds;
alter table sites drop column owner_id, drop column owner_phone;

-- The signed-in user's project ids. Security definer so the policies below do
-- not recurse through RLS on sites and businesses; it only ever returns the
-- caller's own ids.
create function my_site_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from sites s
  join businesses b on b.id = s.business_id
  where b.owner_id = auth.uid()
$$;
revoke execute on function my_site_ids() from public, anon;
grant execute on function my_site_ids() to authenticated, service_role;

alter table profiles enable row level security;
alter table businesses enable row level security;
revoke all on profiles, businesses from anon;
revoke all on profiles, businesses from authenticated;
grant select on profiles, businesses to authenticated;

create policy "user reads own profile" on profiles
  for select to authenticated using (id = (select auth.uid()));

create policy "owner reads own business" on businesses
  for select to authenticated using (owner_id = (select auth.uid()));

create policy "owner reads own projects" on sites
  for select to authenticated using (id in (select my_site_ids()));

create policy "owner reads own customers" on customers
  for select to authenticated using (site_id in (select my_site_ids()));

create policy "owner reads own orders" on orders
  for select to authenticated using (site_id in (select my_site_ids()));

create policy "owner reads own actions" on actions
  for select to authenticated using (site_id in (select my_site_ids()));

create policy "owner reads own site builds" on site_builds
  for select to authenticated using (site_id in (select my_site_ids()));

alter publication supabase_realtime add table sites;
