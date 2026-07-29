-- ============================================================================
-- MESH Platform — Seed Data
--
-- Run automatically by `supabase db reset` (which applies migrations then this
-- file), or manually with `supabase db reset --linked` / psql.
--
-- Contents:
--   * 2 organizations (Apex Collision, Bridgeway Auto Body) to demonstrate
--     tenant isolation via RLS.
--   * auth.users + auth.identities for each app user, so you can actually log
--     in. Every seeded user's password is `password123`.
--   * users (EXECUTIVE / MANAGER / TECH / ADJUSTER per org).
--   * vehicles, repair_orders spanning several stages (incl. HOLD_* gates),
--     a total-loss audit, hold-gate logs, a proof of payment, and a 50/10/40
--     payout split set.
--
-- Trigger-derived columns are intentionally omitted from the inserts:
--   * repair_orders.hold_gate_active  -> set from stage
--   * total_loss_audits.risk_score    -> computed from ACV math
--   * payout_splits.net_payout        -> computed from gross * pct
--   * *.organization_id on RO-children -> derived from the parent repair order
--
-- All ids are fixed literals so relationships are easy to trace and re-seed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Auth users (Supabase auth schema). Password for all = 'password123'.
-- ----------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a0e1', 'authenticated', 'authenticated', 'executive@apex.com',     crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Erin Apex"}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a0d1', 'authenticated', 'authenticated', 'manager@apex.com',  crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Marcus Apex"}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a0c1', 'authenticated', 'authenticated', 'tech@apex.com',     crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Tara Tech"}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a0b1', 'authenticated', 'authenticated', 'adjuster@apex.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Aja Adjuster"}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0d1', 'authenticated', 'authenticated', 'manager@bridgeway.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Bea Bridge"}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0c1', 'authenticated', 'authenticated', 'tech@bridgeway.com',    crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Ben Bridge"}')
on conflict (id) do nothing;

-- Email identities so password login resolves the user.
insert into auth.identities
  (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
values
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000a0e1', '{"sub":"00000000-0000-0000-0000-00000000a0e1","email":"executive@apex.com"}',     'email', '00000000-0000-0000-0000-00000000a0e1', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000a0d1', '{"sub":"00000000-0000-0000-0000-00000000a0d1","email":"manager@apex.com"}',  'email', '00000000-0000-0000-0000-00000000a0d1', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000a0c1', '{"sub":"00000000-0000-0000-0000-00000000a0c1","email":"tech@apex.com"}',     'email', '00000000-0000-0000-0000-00000000a0c1', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000a0b1', '{"sub":"00000000-0000-0000-0000-00000000a0b1","email":"adjuster@apex.com"}', 'email', '00000000-0000-0000-0000-00000000a0b1', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000b0d1', '{"sub":"00000000-0000-0000-0000-00000000b0d1","email":"manager@bridgeway.com"}', 'email', '00000000-0000-0000-0000-00000000b0d1', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000b0c1', '{"sub":"00000000-0000-0000-0000-00000000b0c1","email":"tech@bridgeway.com"}',    'email', '00000000-0000-0000-0000-00000000b0c1', now(), now(), now())
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Organizations
-- ----------------------------------------------------------------------------
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000a001', 'Apex Collision'),
  ('00000000-0000-0000-0000-00000000b001', 'Bridgeway Auto Body');

-- ----------------------------------------------------------------------------
-- Locations
-- ----------------------------------------------------------------------------
insert into public.locations (id, organization_id, name, address) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000a001', 'Apex — Downtown',  '120 Main St, Denver, CO 80202'),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-00000000a001', 'Apex — Airport',   '8800 Pena Blvd, Denver, CO 80249'),
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000b001', 'Bridgeway — Main', '45 River Rd, Austin, TX 78701');

-- ----------------------------------------------------------------------------
-- Users (app profiles linked to auth.users)
-- ----------------------------------------------------------------------------
insert into public.users (id, auth_user_id, organization_id, role, full_name, email) values
  ('00000000-0000-0000-0000-00000000a1e1', '00000000-0000-0000-0000-00000000a0e1', '00000000-0000-0000-0000-00000000a001', 'EXECUTIVE', 'Erin Apex',    'executive@apex.com'),
  ('00000000-0000-0000-0000-00000000a1d1', '00000000-0000-0000-0000-00000000a0d1', '00000000-0000-0000-0000-00000000a001', 'MANAGER',   'Marcus Apex',  'manager@apex.com'),
  ('00000000-0000-0000-0000-00000000a1c1', '00000000-0000-0000-0000-00000000a0c1', '00000000-0000-0000-0000-00000000a001', 'TECH',      'Tara Tech',    'tech@apex.com'),
  ('00000000-0000-0000-0000-00000000a1b1', '00000000-0000-0000-0000-00000000a0b1', '00000000-0000-0000-0000-00000000a001', 'ADJUSTER',  'Aja Adjuster', 'adjuster@apex.com'),
  ('00000000-0000-0000-0000-00000000b1d1', '00000000-0000-0000-0000-00000000b0d1', '00000000-0000-0000-0000-00000000b001', 'MANAGER',   'Bea Bridge',   'manager@bridgeway.com'),
  ('00000000-0000-0000-0000-00000000b1c1', '00000000-0000-0000-0000-00000000b0c1', '00000000-0000-0000-0000-00000000b001', 'TECH',      'Ben Bridge',   'tech@bridgeway.com');

-- ----------------------------------------------------------------------------
-- Vehicles
-- ----------------------------------------------------------------------------
insert into public.vehicles (id, organization_id, vin, make, model, year, paint_code) values
  ('00000000-0000-0000-0000-00000000a5f1', '00000000-0000-0000-0000-00000000a001', '1FTFW1E80MFA00001', 'Ford',  'F-150',   2021, 'UM-Oxford White'),  -- aluminum body
  ('00000000-0000-0000-0000-00000000a5f2', '00000000-0000-0000-0000-00000000a001', '1HGCV1F30LA000002', 'Honda', 'Accord',  2020, 'NH-731P Crystal Black'),
  ('00000000-0000-0000-0000-00000000a5f3', '00000000-0000-0000-0000-00000000a001', '5YJ3E1EA7KF000003', 'Tesla', 'Model 3', 2019, 'PPSW Pearl White'),
  ('00000000-0000-0000-0000-00000000b5f1', '00000000-0000-0000-0000-00000000b001', '4T1B11HK5KU000004', 'Toyota','Camry',   2019, '040 Super White');

-- ----------------------------------------------------------------------------
-- Repair orders (hold_gate_active is derived from stage by trigger)
-- ----------------------------------------------------------------------------
insert into public.repair_orders (id, organization_id, location_id, vehicle_id, customer_name, claim_number, stage) values
  ('00000000-0000-0000-0000-00000000a6f1', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000a5f1', 'Dana Whitfield', 'APX-2026-0001', 'INTAKE'),
  ('00000000-0000-0000-0000-00000000a6f2', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000a5f2', 'Leo Marsh',      'APX-2026-0002', 'PDR_REPAIR'),
  ('00000000-0000-0000-0000-00000000a6f3', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-00000000a5f3', 'Priya Nair',     'APX-2026-0003', 'HOLD_CARRIER'),
  ('00000000-0000-0000-0000-00000000a6f4', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-00000000a5f1', 'Sam Okoye',      'APX-2026-0004', 'HOLD_TOTAL_LOSS'),
  ('00000000-0000-0000-0000-00000000a6f5', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000a5f2', 'Grace Lin',      'APX-2026-0005', 'QC_DELIVERY'),
  ('00000000-0000-0000-0000-00000000b6f1', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000b5f1', 'Hector Ruiz',    'BRG-2026-0001', 'HOLD_PARTS');

-- ----------------------------------------------------------------------------
-- Total-loss audit (risk_score computed: 15500 / (18000 * 0.75) = 1.1481)
-- Risk > 1 => conventional cut/replace exceeds the state threshold; PDR wins.
-- ----------------------------------------------------------------------------
insert into public.total_loss_audits
  (id, ro_id, acv_amount, conventional_estimate, pdr_estimate, state_threshold_pct) values
  ('00000000-0000-0000-0000-00000000a7f1', '00000000-0000-0000-0000-00000000a6f4', 18000.00, 15500.00, 4200.00, 75.00);

-- ----------------------------------------------------------------------------
-- Hold-gate logs (organization_id derived from parent RO)
--   * two OPEN gates (unlocked_at null) for the HOLD_* orders above
--   * one RESOLVED parts gate for the RO that has since moved to QC
-- ----------------------------------------------------------------------------
insert into public.hold_gate_logs (id, ro_id, gate_type, locked_at, unlocked_at, resolved_by) values
  ('00000000-0000-0000-0000-00000000a8f1', '00000000-0000-0000-0000-00000000a6f3', 'CARRIER_SUPPLEMENT',  now() - interval '2 days', null, null),
  ('00000000-0000-0000-0000-00000000a8f2', '00000000-0000-0000-0000-00000000a6f4', 'TOTAL_LOSS_REBUTTAL', now() - interval '1 day',  null, null),
  ('00000000-0000-0000-0000-00000000a8f3', '00000000-0000-0000-0000-00000000a6f5', 'PARTS_BACKORDER',     now() - interval '6 days', now() - interval '3 days', '00000000-0000-0000-0000-00000000a1d1'),
  ('00000000-0000-0000-0000-00000000b8f1', '00000000-0000-0000-0000-00000000b6f1', 'PARTS_BACKORDER',     now() - interval '4 hours', null, null);

-- ----------------------------------------------------------------------------
-- Proof of payment for the delivered RO (APX-2026-0005), OCR verified
-- ----------------------------------------------------------------------------
insert into public.proof_of_payments (id, ro_id, check_amount, check_image_url, ocr_verified_flag) values
  ('00000000-0000-0000-0000-00000000a9f1', '00000000-0000-0000-0000-00000000a6f5', 5000.00, 'https://storage.example.com/checks/APX-2026-0005.jpg', true);

-- ----------------------------------------------------------------------------
-- Payout split ledger for APX-2026-0005 gross $5,000 (net_payout computed)
--   50% PDR Lead Tech = 2500  |  10% Sales = 500  |  40% House = 2000
-- ----------------------------------------------------------------------------
insert into public.payout_splits
  (id, ro_id, tech_user_id, split_role, gross_amount, tech_split_pct, stripe_transfer_id, status) values
  ('00000000-0000-0000-0000-0000000aa001', '00000000-0000-0000-0000-00000000a6f5', '00000000-0000-0000-0000-00000000a1c1', 'PDR_LEAD', 5000.00, 50.00, 'tr_seed_pdrlead_0005', 'PAID'),
  ('00000000-0000-0000-0000-0000000aa002', '00000000-0000-0000-0000-00000000a6f5', null,                                   'SALES',    5000.00, 10.00, 'tr_seed_sales_0005',   'PAID'),
  ('00000000-0000-0000-0000-0000000aa003', '00000000-0000-0000-0000-00000000a6f5', null,                                   'HOUSE',    5000.00, 40.00, null,                   'PENDING');
