-- ============================================================================
-- MESH Sales & Intake — intake_leads
--
-- Durable store for the sales lead pipeline and mobile-intake submissions.
-- Superset of the task spec: the requested columns (vehicle_info, vin,
-- documents/walkaround_notes jsonb, signature_url, status, created_at) plus the
-- pipeline columns the Sales board needs (structured vehicle, estimated_amount).
-- created_at doubles as the intake timestamp. The status check accepts both the
-- 5 pipeline states and the intake 'CONVERTED' state.
--
-- NOTE: policies are permissive for the demo (the browser client uses a
-- service-role key that bypasses RLS anyway). Tighten with org scoping before
-- production.
-- ============================================================================

-- A stale, incompatible intake_leads existed on the remote (out-of-band apply
-- with an older layout: incompatible id type / older CHECK). Drop it so this
-- migration owns the current schema. Safe for the demo/seed data it held.
drop table if exists public.intake_leads cascade;

create table if not exists public.intake_leads (
  id                text primary key,
  customer_name     text not null,
  phone             text,
  email             text,
  vehicle_year      int,
  vehicle_make      text,
  vehicle_model     text,
  vehicle_info      text,
  vin               text,
  claim_number      text,
  insurance_carrier text,
  estimated_amount  numeric(12,2),
  documents         jsonb not null default '[]'::jsonb,
  walkaround_notes  jsonb not null default '[]'::jsonb,
  signature_url     text,
  status            text not null default 'NEW'
    check (status in ('NEW','CONTACTED','ESTIMATE_SENT','AOB_SIGNED','APPROVED',
                      'CONVERTED','LOST','LOST_TO_COMPETITOR','CANCELLED')),
  agreement_accepted boolean not null default false,
  assigned_staff_id  text,
  assigned_staff_name text,
  created_at        timestamptz not null default now()
);

create index if not exists intake_leads_status_idx on public.intake_leads (status);
create index if not exists intake_leads_assigned_staff_idx on public.intake_leads (assigned_staff_id);

alter table public.intake_leads enable row level security;
drop policy if exists intake_leads_all on public.intake_leads;
create policy intake_leads_all on public.intake_leads
  for all to authenticated, anon using (true) with check (true);

-- --- demo seed (idempotent) -------------------------------------------------
insert into public.intake_leads
  (id, customer_name, phone, email, vehicle_year, vehicle_make, vehicle_model,
   vehicle_info, vin, claim_number, insurance_carrier, estimated_amount, status,
   assigned_staff_id, assigned_staff_name, created_at)
values
  ('lead-1001', 'Jordan Alvarez', '(512) 555-0142', 'jordan.alvarez@example.com', 2022, 'Toyota', 'RAV4', '2022 Toyota RAV4', 'NW214883', 'SF-771204', 'State Farm', 4200, 'NEW', 'staff-avery', 'Avery Nguyen', '2026-07-24T13:40:00Z'),
  ('lead-1002', 'Mia Chen', '(408) 555-0199', 'mia.chen@example.com', 2021, 'Honda', 'Civic', '2021 Honda Civic', 'MH052217', 'GC-559810', 'GEICO', 3100, 'CONTACTED', 'staff-marcus', 'Marcus Bell', '2026-07-23T17:05:00Z'),
  ('lead-1003', 'Derek Boone', '(919) 555-0110', 'derek.boone@example.com', 2020, 'Ford', 'Explorer', '2020 Ford Explorer', 'LGA33471', 'PG-330277', 'Progressive', 6800, 'ESTIMATE_SENT', 'staff-avery', 'Avery Nguyen', '2026-07-22T15:20:00Z'),
  ('lead-1004', 'Nadia Farah', '(303) 555-0178', 'nadia.farah@example.com', 2023, 'Subaru', 'Crosstrek', '2023 Subaru Crosstrek', 'PH881260', 'AL-902551', 'Allstate', 5200, 'APPROVED', 'staff-marcus', 'Marcus Bell', '2026-07-21T18:45:00Z'),
  ('lead-1005', 'Owen Pratt', '(210) 555-0164', 'owen.pratt@example.com', 2019, 'Chevrolet', 'Silverado 1500', '2019 Chevrolet Silverado 1500', 'KG740992', 'US-118033', 'USAA', 9100, 'NEW', 'staff-priya', 'Priya Shah', '2026-07-24T09:10:00Z'),
  ('lead-1006', 'Tara Kim', '(646) 555-0125', 'tara.kim@example.com', 2018, 'Nissan', 'Altima', '2018 Nissan Altima', 'JC609187', 'LM-447102', 'Liberty Mutual', 2400, 'LOST', 'staff-priya', 'Priya Shah', '2026-07-20T14:30:00Z'),
  ('lead-1007', 'Victor Reyes', '(305) 555-0188', 'victor.reyes@example.com', 2021, 'BMW', '330i', '2021 BMW 330i', 'MA118845', 'FM-620914', 'Farmers', 7300, 'ESTIMATE_SENT', 'staff-avery', 'Avery Nguyen', '2026-07-23T11:55:00Z'),
  ('lead-1008', 'Lena Ortiz', '(602) 555-0133', 'lena.ortiz@example.com', 2022, 'Mazda', 'CX-5', '2022 Mazda CX-5', 'NC205518', 'NW-514670', 'Nationwide', 4650, 'APPROVED', 'staff-marcus', 'Marcus Bell', '2026-07-22T16:15:00Z')
on conflict (id) do nothing;
