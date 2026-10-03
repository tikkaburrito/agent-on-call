-- Agent on Call: schema, RLS, realtime, site-scoped read functions, warm pinger.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------- tables

create table sites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  owner_phone text unique not null,      -- E.164, caller ID lookup
  name text not null,
  slug text unique not null,
  product_name text not null,
  price_cents int not null check (price_cents > 0),
  landing_url text,                      -- set by the site builder
  created_at timestamptz default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  name text not null,
  email text not null,
  phone text,
  consent boolean not null default false,
  welcomed_at timestamptz,
  created_at timestamptz default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  customer_id uuid not null references customers(id),
  amount_cents int not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  stripe_checkout_session_id text,
  stripe_invoice_id text,
  hosted_invoice_url text,
  created_at timestamptz default now(),
  paid_at timestamptz
);

create table actions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  batch_id uuid not null,
  type text not null check (type in ('email', 'sms', 'invoice')),
  customer_id uuid not null references customers(id),
  payload jsonb not null,                    -- subject, body, amount_cents, description
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'executing', 'executed', 'failed', 'cancelled', 'simulated')),
  result jsonb,
  source text not null default 'call',
  created_at timestamptz default now(),
  executed_at timestamptz
);

create table site_builds (                    -- landing pages deployed by the agent
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  status text not null default 'building' check (status in ('building', 'live', 'failed')),
  url text,
  vercel_deployment_id text,
  copy jsonb,
  error text,
  created_at timestamptz default now(),
  finished_at timestamptz
);

create table stripe_events (                  -- webhook idempotency
  id text primary key,
  received_at timestamptz default now()
);

create index customers_site_idx on customers (site_id, created_at desc);
create index orders_site_idx on orders (site_id, status);
create index orders_customer_idx on orders (customer_id);
create index actions_batch_idx on actions (batch_id);
create index actions_site_idx on actions (site_id, created_at desc);
create index site_builds_site_idx on site_builds (site_id, created_at desc);

-- ---------------------------------------------------------------- RLS
-- Owners can only read rows of sites they own. No public policies at all:
-- writes happen through the service key (server route + edge functions).

alter table sites enable row level security;
alter table customers enable row level security;
alter table orders enable row level security;
alter table actions enable row level security;
alter table site_builds enable row level security;
alter table stripe_events enable row level security;

revoke all on sites, customers, orders, actions, site_builds, stripe_events from anon;
revoke all on sites, customers, orders, actions, site_builds, stripe_events from authenticated;
grant select on sites, customers, orders, actions, site_builds to authenticated;

create policy "owner reads own site" on sites
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "owner reads own customers" on customers
  for select to authenticated
  using (site_id in (select id from sites where owner_id = (select auth.uid())));

create policy "owner reads own orders" on orders
  for select to authenticated
  using (site_id in (select id from sites where owner_id = (select auth.uid())));

create policy "owner reads own actions" on actions
  for select to authenticated
  using (site_id in (select id from sites where owner_id = (select auth.uid())));

create policy "owner reads own site builds" on site_builds
  for select to authenticated
  using (site_id in (select id from sites where owner_id = (select auth.uid())));

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table actions, customers, orders, site_builds;

-- ---------------------------------------------------------------- site-scoped read functions
-- The only way the agent reads data. Security invoker, so an owner calling
-- them from the dashboard is still bound by RLS.

create function needs_attention(p_site_id uuid, p_minutes int default 2)
returns table (kind text, customer_id uuid, name text, email text, phone text, detail text)
language sql
stable
set search_path = public
as $$
  select 'welcome_pending'::text, c.id, c.name, c.email, c.phone,
         'signed up ' || to_char(c.created_at, 'Mon DD') || ', not welcomed yet'
  from customers c
  where c.site_id = p_site_id
    and c.welcomed_at is null

  union all

  select 'unpaid'::text, c.id, c.name, c.email, c.phone,
         'unpaid order for $' || trim(to_char(o.total_cents / 100.0, 'FM999990.00'))
  from customers c
  join lateral (
    select sum(amount_cents) as total_cents
    from orders
    where customer_id = c.id
      and site_id = p_site_id
      and status = 'pending'
      and created_at < now() - make_interval(mins => p_minutes)
  ) o on o.total_cents is not null
  where c.site_id = p_site_id

  union all

  select 'dropped_off'::text, c.id, c.name, c.email, c.phone,
         'signed up ' || to_char(c.created_at, 'Mon DD') || ' but never ordered'
  from customers c
  where c.site_id = p_site_id
    and c.created_at < now() - make_interval(mins => p_minutes)
    and not exists (select 1 from orders o where o.customer_id = c.id)
$$;

create function find_customers(p_site_id uuid, p_query text default null, p_segment text default 'all')
returns table (id uuid, name text, email text, phone text, consent boolean, state text, pending_cents int)
language sql
stable
set search_path = public
as $$
  with base as (
    select c.id, c.name, c.email, c.phone, c.consent, c.welcomed_at, c.created_at,
           exists (select 1 from orders o where o.customer_id = c.id) as has_order,
           coalesce((select sum(o.amount_cents) from orders o
                     where o.customer_id = c.id and o.status = 'pending'), 0)::int as pending_cents
    from customers c
    where c.site_id = p_site_id
      and (
        p_query is null or p_query = ''
        or c.name ilike '%' || p_query || '%'
        or c.email ilike '%' || p_query || '%'
      )
  )
  select b.id, b.name, b.email, b.phone, b.consent,
         case
           when b.pending_cents > 0 then 'unpaid'
           when not b.has_order then 'dropped_off'
           else 'paid'
         end as state,
         b.pending_cents
  from base b
  where case coalesce(p_segment, 'all')
          when 'all' then true
          when 'new_today' then b.created_at > now() - interval '24 hours'
          when 'welcome_pending' then b.welcomed_at is null
          when 'unpaid' then b.pending_cents > 0
          when 'dropped_off' then not b.has_order
          else false
        end
  order by b.created_at desc
$$;

revoke execute on function needs_attention(uuid, int) from public, anon;
revoke execute on function find_customers(uuid, text, text) from public, anon;
grant execute on function needs_attention(uuid, int) to authenticated, service_role;
grant execute on function find_customers(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- warm pinger
-- Keeps edge functions warm so tool calls stay well under Vapi's timeout.
-- Off:  select cron.unschedule('warm-functions');
-- On:   re-run the cron.schedule statement below.

select cron.schedule(
  'warm-functions',
  '* * * * *',
  $$
    select net.http_get('https://ckwsgvgledkgkuwzbrrd.supabase.co/functions/v1/health');
    select net.http_get('https://ckwsgvgledkgkuwzbrrd.supabase.co/functions/v1/vapi-tools');
    select net.http_get('https://ckwsgvgledkgkuwzbrrd.supabase.co/functions/v1/executor');
    select net.http_get('https://ckwsgvgledkgkuwzbrrd.supabase.co/functions/v1/site-builder');
  $$
);
