-- ============================================================================
-- MESH Sales — Multi-Vehicle Household Leads
--
-- A storm can hit multiple vehicles at one property. intake_leads stays
-- 1:1 with its existing singular vehicle_year/vehicle_make/vehicle_model/vin
-- columns (the primary vehicle — every existing call site across
-- MobileIntakeWizard, DigitalIntakeQuickAdd, QuickLeadModal, and the board
-- keeps working unchanged). This adds a child table for vehicle #2+, purely
-- additive: empty for the vast majority of leads, which stay single-vehicle.
--
-- severity reuses the same vocabulary as intake_leads.severity (Digital
-- Inbound instant triage) — one severity concept, not two.
-- ============================================================================

create table if not exists public.lead_vehicles (
  id            uuid primary key default gen_random_uuid(),
  lead_id       text not null references public.intake_leads(id) on delete cascade,
  vehicle_year  int,
  vehicle_make  text,
  vehicle_model text,
  vin           text,
  severity      text check (severity in ('MINOR','MODERATE','SEVERE','CATASTROPHIC')),
  created_at    timestamptz not null default now()
);

create index if not exists lead_vehicles_lead_id_idx on public.lead_vehicles (lead_id);

alter table public.lead_vehicles enable row level security;
drop policy if exists lead_vehicles_all on public.lead_vehicles;
create policy lead_vehicles_all on public.lead_vehicles
  for all to authenticated, anon using (true) with check (true);
