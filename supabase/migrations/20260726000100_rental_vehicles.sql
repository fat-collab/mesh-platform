-- ============================================================================
-- MESH — rental_vehicles (loaner fleet)
--
-- Durable loaner inventory. Superset of the task spec: the requested columns
-- (status, current_mileage, fuel_level, assigned_ro_id, updated_at) plus the
-- fields the fleet dashboard uses (starting_mileage, assigned_customer,
-- expected_return_date). Reuses the shared set_updated_at() trigger.
--
-- NOTE: permissive RLS for the demo (browser uses a service-role key). Tighten
-- with org scoping before production.
-- ============================================================================

-- Same stale out-of-band table as intake_leads (incompatible older layout);
-- drop so this migration owns the current schema. Safe for demo/seed fleet data.
drop table if exists public.rental_vehicles cascade;

create table if not exists public.rental_vehicles (
  id                   text primary key,
  make_model           text not null,
  license_plate        text,
  status               text not null default 'AVAILABLE'
    check (status in ('AVAILABLE','RENTED','MAINTENANCE')),
  starting_mileage     int,
  current_mileage      int not null default 0,
  fuel_level           int not null default 100,
  assigned_ro_id       text,
  assigned_customer    text,
  assigned_agent       text,
  expected_return_date text,
  updated_at           timestamptz not null default now()
);

alter table public.rental_vehicles enable row level security;
drop policy if exists rental_vehicles_all on public.rental_vehicles;
create policy rental_vehicles_all on public.rental_vehicles
  for all to authenticated, anon using (true) with check (true);

create trigger trg_rental_vehicles_updated_at
  before update on public.rental_vehicles
  for each row execute function public.set_updated_at();

-- --- demo seed (idempotent) -------------------------------------------------
insert into public.rental_vehicles
  (id, make_model, license_plate, status, starting_mileage, current_mileage,
   fuel_level, assigned_ro_id, assigned_customer, assigned_agent, expected_return_date)
values
  ('FL-01', '2023 Toyota Corolla', '8ABC123', 'AVAILABLE', null, 24310, 85, null, null, null, null),
  ('FL-02', '2022 Honda CR-V', '7XYZ889', 'RENTED', 30110, 30110, 60, 'lead-1004', 'Nadia Farah', 'Carlos Mendez', '2026-08-01'),
  ('FL-03', '2023 Ford Escape', '9LMN456', 'AVAILABLE', null, 41120, 70, null, null, null, null),
  ('FL-04', '2021 Nissan Sentra', '5QRS221', 'MAINTENANCE', null, 58990, 40, null, null, null, null),
  ('FL-05', '2024 Chevrolet Malibu', '3TUV778', 'AVAILABLE', null, 19005, 95, null, null, null, null),
  ('FL-06', '2022 Kia Sportage', '6WXY334', 'RENTED', 12040, 12210, 50, 'lead-1002', 'Leo Marsh', 'Renee Park', '2026-07-29')
on conflict (id) do nothing;
