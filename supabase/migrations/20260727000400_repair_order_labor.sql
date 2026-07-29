-- ============================================================================
-- MESH Ops — repair_order_labor
--
-- RO-scoped labor & technician time tracking: one RO → many operations, each
-- with an assigned technician, estimated vs. actual hours, a work status, and
-- clock-in/out timestamps. Feeds the drawer's shop efficiency ratio
-- (total estimated ÷ total actual hours).
--
-- NOTE: policies are permissive for the demo (the browser client uses a
-- service-role key that bypasses RLS anyway). Tighten with org scoping before
-- production.
-- ============================================================================

create table if not exists public.repair_order_labor (
  id               uuid primary key default gen_random_uuid(),
  repair_order_id  uuid not null references public.repair_orders(id) on delete cascade,
  operation_name   text not null,
  technician_name  text not null,
  estimated_hours  numeric(6,2) not null default 0,
  actual_hours     numeric(6,2) not null default 0,
  status           text not null default 'PENDING'
    check (status in ('PENDING','IN_PROGRESS','COMPLETED')),
  clocked_in_at    timestamptz,
  clocked_out_at   timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists repair_order_labor_ro_idx
  on public.repair_order_labor (repair_order_id);

alter table public.repair_order_labor enable row level security;
drop policy if exists repair_order_labor_all on public.repair_order_labor;
create policy repair_order_labor_all on public.repair_order_labor
  for all to authenticated, anon using (true) with check (true);
