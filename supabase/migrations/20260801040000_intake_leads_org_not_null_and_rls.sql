-- ============================================================================
-- MESH Sales — intake_leads: delete unresolved-org rows, set organization_id
-- NOT NULL, org-scope RLS on intake_leads / lead_vehicles ONLY.
-- MIGRATION B of 2 — DESTRUCTIVE. Requires 20260801030000_intake_leads_org_
-- and_vin.sql (Migration A) AND 20260801035000_user_role_add_sales.sql
-- (Migration C) to have already run and been COMMITTED — the latter adds
-- the 'SALES' value this file's policies now reference; Postgres rejects
-- using a new enum value inside the same transaction that added it, so C
-- must be a separate, already-committed migration before this one runs.
--
-- Wrapped in an explicit transaction (begin/commit below) so the delete and
-- the NOT NULL constraint are atomic — either both happen or neither does.
--
-- rental_vehicles is deliberately NOT scoped here — see the standalone
-- comment block near the end of this file for the rationale and the
-- evidence that ruled it out.
--
-- Apply separately from Migration A, after reviewing the RAISE NOTICE row
-- counts this file prints before deleting anything.
--
-- --- FK check: is anything besides lead_vehicles referencing intake_leads? -
-- Confirmed via `grep -rn "references public.intake_leads" supabase/
-- migrations/*.sql`: only lead_vehicles.lead_id (20260801010000_lead_
-- vehicles.sql:17, `on delete cascade`) is a real FK. remote_aob_links.lead_id
-- and rental_vehicles.assigned_ro_id both reference intake_leads.id
-- conceptually (per their own migration comments / CLAUDE.md) but are plain
-- `text` columns with NO declared FK constraint — deleting an intake_leads
-- row does not cascade to either of them, and won't error on delete. Their
-- values simply go stale (pointing at an id that no longer exists), which is
-- a pre-existing condition of this schema's design (loose references), not
-- something this migration introduces.
-- ============================================================================

begin;

do $$
declare
  total_leads int;
  orphan_leads int;
  surviving_leads int;
  cascaded_lead_vehicles int;
begin
  select count(*) into total_leads from public.intake_leads;
  select count(*) into orphan_leads from public.intake_leads where organization_id is null;
  surviving_leads := total_leads - orphan_leads;
  select count(*) into cascaded_lead_vehicles
    from public.lead_vehicles lv
    join public.intake_leads il on il.id = lv.lead_id
    where il.organization_id is null;

  raise notice 'intake_leads total rows: %', total_leads;
  raise notice 'intake_leads rows to DELETE (organization_id is null): %', orphan_leads;
  raise notice 'intake_leads rows to KEEP (organization_id resolved): %', surviving_leads;
  raise notice 'lead_vehicles rows that will cascade-delete with their orphaned parent: %', cascaded_lead_vehicles;
end $$;

delete from public.intake_leads where organization_id is null;

alter table public.intake_leads
  alter column organization_id set not null;

-- --- intake_leads RLS ---------------------------------------------------------
-- SALES now exists in public.user_role (added by 20260801035000, committed
-- before this file runs) — included below alongside the existing operational
-- roles. Sales reps write leads directly (intake capture, routing), so SALES
-- belongs on intake_leads' write policy the same way it belongs on the
-- Migration D tables sales reps touch.
drop policy if exists intake_leads_all on public.intake_leads;
drop policy if exists intake_leads_select on public.intake_leads;
drop policy if exists intake_leads_write on public.intake_leads;

create policy intake_leads_select on public.intake_leads
  for select to authenticated
  using (organization_id = public.current_user_org_id());

create policy intake_leads_write on public.intake_leads
  for all to authenticated
  using (
    organization_id = public.current_user_org_id()
    and public.current_user_is('SALES', 'TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_is('SALES', 'TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

-- --- lead_vehicles RLS ---------------------------------------------------------
-- Only viable now that intake_leads has a real, NOT NULL organization_id —
-- before this migration, lead_vehicles had no path to an org at all (see
-- 20260801020000_organization_scoped_rls.sql's skip list). SALES included
-- for the same reason as intake_leads_write above — a lead's extra vehicles
-- are captured by the same sales rep taking the intake.
drop policy if exists lead_vehicles_all on public.lead_vehicles;
drop policy if exists lead_vehicles_select on public.lead_vehicles;
drop policy if exists lead_vehicles_write on public.lead_vehicles;

create policy lead_vehicles_select on public.lead_vehicles
  for select to authenticated
  using (
    exists (
      select 1 from public.intake_leads il
      where il.id = public.lead_vehicles.lead_id
        and il.organization_id = public.current_user_org_id()
    )
  );

create policy lead_vehicles_write on public.lead_vehicles
  for all to authenticated
  using (
    exists (
      select 1 from public.intake_leads il
      where il.id = public.lead_vehicles.lead_id
        and il.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('SALES', 'TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  )
  with check (
    exists (
      select 1 from public.intake_leads il
      where il.id = public.lead_vehicles.lead_id
        and il.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('SALES', 'TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

-- --- rental_vehicles — deliberately OUT OF SCOPE for this migration -----------
-- ============================================================================
-- NOT SCOPED, ON PURPOSE. Kept as a record of why, so this isn't silently
-- revisited without the context below.
--
-- Decision: the loaner fleet is shop inventory, not tenant data — no PII, no
-- claim linkage — so org-scoping it isn't the obviously-correct move rental_
-- vehicles' data actually calls for. Its permissive policy (`for all to
-- authenticated, anon using (true) with check (true)`, from 20260726000100_
-- rental_vehicles.sql) is left in place.
--
-- Even setting that aside, an EXISTS-based policy through assigned_ro_id was
-- ruled out on technical grounds: rental_vehicles has no organization_id and
-- no reliable FK of its own; the only candidate join is assigned_ro_id (text,
-- nullable) -> intake_leads.id, which per CLAUDE.md §6 item 4 is exactly what
-- it stores (not a repair_orders id). That join is ONLY populated once a
-- vehicle is reserved/rented — every AVAILABLE or MAINTENANCE unit has
-- assigned_ro_id = null and cannot match such a clause at all.
--
-- Concrete, evidenced consequences a naive version of this policy would have
-- had:
--   * SELECT: src/lib/rental-db.ts:64-79 (getFleet) and :82-85
--     (getAvailableVehicles, called by MobileIntakeWizard to populate the
--     loaner picker) both read via the plain browser client. Every
--     AVAILABLE/MAINTENANCE row would become invisible to everyone — the
--     loaner picker would show nothing to select.
--   * WRITE: src/lib/rental-db.ts:103-135 (assignVehicle) ALSO writes via
--     the plain browser client — NOT a service-role Server Action, unlike
--     src/app/actions/fleet-reservation.ts's reserveVehicleForLead (which
--     already bypasses RLS). A `using` clause on UPDATE evaluates against
--     the OLD row: a vehicle's first-ever assignment (AVAILABLE ->
--     RESERVED/RENTED) has assigned_ro_id = null on the old row, so such a
--     policy would reject that UPDATE every time — not an edge case, the
--     common case.
--
-- Right fix, for later, its own migration: give rental_vehicles a real
-- organization_id column (which org's fleet this unit belongs to) rather
-- than deriving one through whichever lead currently holds it.
-- ============================================================================

commit;
