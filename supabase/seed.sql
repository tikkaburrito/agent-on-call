-- Fake demo data only: @example.com addresses and 555-01xx numbers.
-- Idempotent (fixed ids). Demo users, their profiles and business ownership
-- are created by `npx tsx scripts/seed-demo.ts` (auth users need the admin API).

insert into businesses (id, name) values
  ('11111111-1111-4111-8111-111111111111', 'Sunrise Yoga Studio'),
  ('22222222-2222-4222-8222-222222222222', 'Harbor Coffee Roasters')
on conflict (id) do nothing;

-- Projects. Sunrise has two; Harbor has one.
insert into sites (id, business_id, name, slug, product_name, price_cents, headline, subhead) values
  ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Sunrise Yoga Studio', 'sunrise-yoga', 'Intro class pack', 4900,
   'Start your mornings on the mat.', 'Three beginner-friendly classes with our teachers. Come as you are; mats are provided.'),
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Sunrise Yoga Studio', 'sunrise-membership', 'Monthly membership', 8900,
   'Make it a habit.', 'Unlimited classes, every day of the week. Pause or cancel any time.'),
  ('22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'Harbor Coffee Roasters', 'harbor-coffee', 'Tasting flight', 2500,
   'Taste the harbor.', 'Four single-origin coffees, roasted this week and shipped to your door.')
on conflict (id) do update set
  business_id = excluded.business_id, headline = excluded.headline, subhead = excluded.subhead;

insert into customers (id, site_id, name, email, phone, consent, welcomed_at, created_at) values
  -- Sunrise / Intro class pack
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Maya Chen',       'maya.chen@example.com',       '+14155550101', true,  now() - interval '6 days',  now() - interval '6 days'),
  ('a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Liam Patel',      'liam.patel@example.com',      '+14155550102', true,  now() - interval '5 days',  now() - interval '5 days'),
  ('a0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Sofia Rossi',     'sofia.rossi@example.com',     '+14155550103', true,  null,                       now() - interval '5 hours'),
  ('a0000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Noah Kim',        'noah.kim@example.com',        '+14155550104', false, now() - interval '1 day',   now() - interval '1 day'),
  ('a0000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Ava Johnson',     'ava.johnson@example.com',     '+14155550105', true,  null,                       now() - interval '3 hours'),
  ('a0000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'Ethan Brown',     'ethan.brown@example.com',     null,           false, now() - interval '3 days',  now() - interval '3 days'),
  ('a0000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'Zoe Martinez',    'zoe.martinez@example.com',    '+14155550107', true,  null,                       now() - interval '2 hours'),
  ('a0000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', 'Lucas Nguyen',    'lucas.nguyen@example.com',    '+14155550108', true,  now() - interval '2 days',  now() - interval '2 days'),
  ('a0000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', 'Grace Okafor',    'grace.okafor@example.com',    '+14155550109', true,  now() - interval '9 days',  now() - interval '9 days'),
  ('a0000000-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111', 'Daniel Alvarez',  'daniel.alvarez@example.com',  '+14155550110', true,  now() - interval '8 days',  now() - interval '8 days'),
  ('a0000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'Hannah Schmidt',  'hannah.schmidt@example.com',  null,           false, now() - interval '7 days',  now() - interval '7 days'),
  ('a0000000-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111', 'Omar Haddad',     'omar.haddad@example.com',     '+14155550112', true,  now() - interval '4 days',  now() - interval '4 days'),
  ('a0000000-0000-4000-8000-000000000013', '11111111-1111-4111-8111-111111111111', 'Isla Thompson',   'isla.thompson@example.com',   '+14155550113', false, now() - interval '4 days',  now() - interval '4 days'),
  ('a0000000-0000-4000-8000-000000000014', '11111111-1111-4111-8111-111111111111', 'Ravi Menon',      'ravi.menon@example.com',      '+14155550114', true,  now() - interval '30 hours', now() - interval '30 hours'),
  -- Sunrise / Monthly membership
  ('a3000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Maya Chen',       'maya.chen@example.com',       '+14155550101', true,  now() - interval '4 days',  now() - interval '4 days'),
  ('a3000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'Lucas Nguyen',    'lucas.nguyen@example.com',    '+14155550108', true,  now() - interval '1 day',   now() - interval '1 day'),
  ('a3000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'Elena Petrova',   'elena.petrova@example.com',   '+14155550131', true,  null,                       now() - interval '6 hours'),
  ('a3000000-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', 'Marcus Reid',     'marcus.reid@example.com',     '+14155550132', true,  now() - interval '2 days',  now() - interval '2 days'),
  ('a3000000-0000-4000-8000-000000000005', '33333333-3333-4333-8333-333333333333', 'Yuki Tanaka',     'yuki.tanaka@example.com',     null,           false, null,                       now() - interval '8 hours'),
  -- Harbor / Tasting flight (isolation tests use these)
  ('b0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Priya Shah',      'priya.shah@example.com',      '+14155550121', true,  null,                       now() - interval '4 hours'),
  ('b0000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Tom Becker',      'tom.becker@example.com',      '+14155550122', false, now() - interval '1 day',   now() - interval '1 day'),
  ('b0000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'Nina Costa',      'nina.costa@example.com',      '+14155550123', true,  now() - interval '3 days',  now() - interval '3 days'),
  ('b0000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'Jamal Wright',    'jamal.wright@example.com',    '+14155550124', true,  now() - interval '2 days',  now() - interval '2 days')
on conflict (id) do nothing;

insert into orders (id, site_id, customer_id, amount_cents, status, created_at, paid_at) values
  ('c0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', 4900, 'paid',    now() - interval '6 days',  now() - interval '6 days'),
  ('c0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000002', 4900, 'paid',    now() - interval '5 days',  now() - interval '5 days'),
  ('c0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000003', 4900, 'pending', now() - interval '5 hours', null),
  ('c0000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000004', 4900, 'pending', now() - interval '1 day',   null),
  ('c0000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000007', 4900, 'pending', now() - interval '2 hours', null),
  ('c0000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000008', 4900, 'paid',    now() - interval '2 days',  now() - interval '2 days'),
  ('c0000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000009', 4900, 'paid',    now() - interval '9 days',  now() - interval '9 days'),
  ('c0000000-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000010', 4900, 'paid',    now() - interval '8 days',  now() - interval '8 days'),
  ('c0000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000011', 4900, 'paid',    now() - interval '7 days',  now() - interval '7 days'),
  ('c0000000-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000012', 4900, 'paid',    now() - interval '4 days',  now() - interval '4 days'),
  ('c0000000-0000-4000-8000-000000000013', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000013', 4900, 'paid',    now() - interval '4 days',  now() - interval '4 days'),
  ('c0000000-0000-4000-8000-000000000014', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000014', 4900, 'paid',    now() - interval '30 hours', now() - interval '30 hours'),
  ('c3000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'a3000000-0000-4000-8000-000000000001', 8900, 'paid',    now() - interval '4 days',  now() - interval '4 days'),
  ('c3000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'a3000000-0000-4000-8000-000000000002', 8900, 'pending', now() - interval '1 day',   null),
  ('c3000000-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', 'a3000000-0000-4000-8000-000000000004', 8900, 'paid',    now() - interval '2 days',  now() - interval '2 days'),
  ('d0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-000000000001', 2500, 'pending', now() - interval '4 hours', null),
  ('d0000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-000000000003', 2500, 'paid',    now() - interval '3 days',  now() - interval '3 days'),
  ('d0000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-000000000004', 2500, 'paid',    now() - interval '2 days',  now() - interval '2 days')
on conflict (id) do nothing;
