-- Standing rules an owner switches on by voice, and free (100% off) offers.

alter table sites drop constraint sites_discount_percent_check;
alter table sites add constraint sites_discount_percent_check check (discount_percent between 0 and 100);

create table automations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  kind text not null check (kind in ('welcome_new_signups', 'remind_unpaid', 'invoice_unpaid')),
  enabled boolean not null default false,
  delay_minutes int not null default 60 check (delay_minutes between 1 and 43200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, kind)
);

alter table automations enable row level security;
revoke all on automations from anon;
revoke all on automations from authenticated;
grant select on automations to authenticated;

create policy "owner or admin reads automations" on automations
  for select to authenticated
  using (is_admin() or site_id in (select my_site_ids()));

alter publication supabase_realtime add table automations;

-- Runs the enabled automations every minute. The function takes no input and
-- only acts on rules an owner has switched on, so the trigger needs no secret.
-- Off:  select cron.unschedule('run-automations');
select cron.schedule(
  'run-automations',
  '* * * * *',
  $$ select net.http_post('https://ckwsgvgledkgkuwzbrrd.supabase.co/functions/v1/automations', '{}'::jsonb); $$
);
