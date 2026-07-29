-- ============================================================================
-- MESH Ops — order_assignments
--
-- Relational staffing for a repair order: one RO → many staff, each in a role
-- (Sales, Estimator, Body Tech, Painter, Foreman). The lead-level intake owner
-- (intake_leads.assigned_staff_*) seeds the initial SALES assignment on
-- conversion; the board card still shows that single owner denormalized, while
-- this table carries the full floor staffing.
--
-- NOTE: policies are permissive for the demo (the browser client uses a
-- service-role key that bypasses RLS anyway). Tighten with org scoping before
-- production.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'staff_role') then
    create type public.staff_role as enum (
      'SALES',
      'ESTIMATOR',
      'BODY_TECH',
      'PAINTER',
      'FOREMAN'
    );
  end if;
end
$$;

create table if not exists public.order_assignments (
  id               uuid primary key default gen_random_uuid(),
  repair_order_id  uuid not null references public.repair_orders(id) on delete cascade,
  staff_id         text,
  staff_name       text not null,
  role             public.staff_role not null,
  assigned_at      timestamptz not null default now()
);

create index if not exists order_assignments_ro_idx
  on public.order_assignments (repair_order_id);
create index if not exists order_assignments_staff_idx
  on public.order_assignments (staff_id);

alter table public.order_assignments enable row level security;
drop policy if exists order_assignments_all on public.order_assignments;
create policy order_assignments_all on public.order_assignments
  for all to authenticated, anon using (true) with check (true);
