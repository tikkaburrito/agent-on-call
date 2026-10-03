-- Fake demo data only: @example.com addresses and 555-01xx numbers.
-- Idempotent (fixed ids). owner_phone is a placeholder until
-- `npx tsx scripts/set-owner.ts` copies OWNER_PHONE from .env.local.

insert into sites (id, owner_phone, name, slug, product_name, price_cents) values
  ('11111111-1111-4111-8111-111111111111', '+15555550001', 'Sunrise Yoga Studio', 'sunrise-yoga', 'Intro class pack', 4900),
  ('22222222-2222-4222-8222-222222222222', '+15555550002', 'Harbor Coffee Roasters', 'harbor-coffee', 'Tasting flight', 2500)
on conflict (id) do nothing;

insert into customers (id, site_id, name, email, phone, consent, welcomed_at, created_at) values
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Maya Chen',     'maya.chen@example.com',     '+14155550101', true,  now() - interval '6 days', now() - interval '6 days'),
  ('a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Liam Patel',    'liam.patel@example.com',    '+14155550102', true,  now() - interval '5 days', now() - interval '5 days'),
  ('a0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Sofia Rossi',   'sofia.rossi@example.com',   '+14155550103', true,  null,                      now() - interval '5 hours'),
  ('a0000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Noah Kim',      'noah.kim@example.com',      '+14155550104', false, now() - interval '1 day',  now() - interval '1 day'),
  ('a0000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Ava Johnson',   'ava.johnson@example.com',   '+14155550105', true,  null,                      now() - interval '3 hours'),
  ('a0000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'Ethan Brown',   'ethan.brown@example.com',   null,           false, now() - interval '3 days', now() - interval '3 days'),
  ('a0000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'Zoe Martinez',  'zoe.martinez@example.com',  '+14155550107', true,  null,                      now() - interval '2 hours'),
  ('a0000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', 'Lucas Nguyen',  'lucas.nguyen@example.com',  '+14155550108', true,  now() - interval '2 days', now() - interval '2 days'),
  -- second site, used by the isolation tests
  ('b0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Priya Shah',    'priya.shah@example.com',    '+14155550121', true,  null,                      now() - interval '4 hours'),
  ('b0000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Tom Becker',    'tom.becker@example.com',    '+14155550122', false, now() - interval '1 day',  now() - interval '1 day')
on conflict (id) do nothing;

insert into orders (id, site_id, customer_id, amount_cents, status, created_at, paid_at) values
  ('c0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', 4900, 'paid',    now() - interval '6 days',  now() - interval '6 days'),
  ('c0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000002', 4900, 'paid',    now() - interval '5 days',  now() - interval '5 days'),
  ('c0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000003', 4900, 'pending', now() - interval '5 hours', null),
  ('c0000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000004', 4900, 'pending', now() - interval '1 day',   null),
  ('c0000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000007', 4900, 'pending', now() - interval '2 hours', null),
  ('c0000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000008', 4900, 'paid',    now() - interval '2 days',  now() - interval '2 days'),
  ('d0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-000000000001', 2500, 'pending', now() - interval '4 hours', null)
on conflict (id) do nothing;
