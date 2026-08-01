-- ============================================================================
-- MESH — Organization-scoped RLS, phase 1
--
-- Replaces permissive (`using (true)`) RLS with organization-scoped policies,
-- modeled exactly on the proven vehicles/repair_orders pattern
-- (20260101000000_init_mesh.sql:510-528): a `_select` policy readable by any
-- authenticated org member, and a `_write` policy (for all commands) gated to
-- both org match and an allowed role, via public.current_user_org_id() /
-- public.current_user_is(...).
--
-- NOT APPLIED as part of authoring this file — review before running
-- `supabase db push`.
--
-- --- SCOPE: 9 of 16 requested tables -----------------------------------------
-- Scoped (this migration): order_assignments, repair_order_parts,
--   repair_order_comms, repair_order_invoices, repair_order_supplements,
--   repair_order_labor, purchase_orders, purchase_order_items,
--   commission_overrides.
--
-- Skipped — no viable organization_id path, or table no longer exists:
--   * intake_leads       — has NO organization_id column anywhere in its
--     migration history (base + legal_carrier_shield + catastrophe_hub +
--     quick_lead_capture). Scoping it needs a new column + a backfill
--     decision (which org owns a pre-existing lead) — out of scope for a
--     pure RLS-policy migration. Left untouched.
--   * lead_vehicles      — only path is lead_vehicles.lead_id -> intake_leads,
--     which has no organization_id (see above). Left untouched.
--   * rental_vehicles    — no organization_id column; its only candidate join
--     column, assigned_ro_id, is explicitly documented (CLAUDE.md §6 item 4)
--     as storing intake_leads.id, NOT a repair_orders id — joining it to
--     repair_orders would be incorrect, and intake_leads has no org column
--     regardless. Left untouched.
--   * supplement_records — ro_id is a loose text reference, not an FK (its
--     own migration comment: "records may predate a DB repair order,
--     matched by ro_id or claim_number in the DAL"). Rows exist with
--     non-uuid ro_id values (e.g. local/mock bridge ids), so casting
--     ro_id::uuid for a join would throw on scan, not just fail to match.
--     Left untouched.
--   * suppliers, parts_catalog, supplier_parts — dropped with cascade by
--     20260730000000_inventory_lockdown.sql (strips the generalized
--     warehouse catalog). These tables no longer exist by the time this
--     migration runs (migrations apply in filename order); no policy to
--     write.
--
-- Excluded per explicit instruction: remote_aob_links (deliberately
-- anon-accessible by design — see 20260801000000_quick_lead_capture.sql's
-- sibling migration comment).
--
-- --- grant select on all tables in schema public to anon (init_mesh.sql:585)
-- Table-level privilege, orthogonal to RLS: it lets the anon role attempt a
-- SELECT at all; RLS then decides which rows (if any) it sees. NOT revoked
-- here — the 7 skipped tables above (plus remote_aob_links) still carry
-- `to authenticated, anon using (true)` policies that depend on this grant
-- remaining in place. Revoking it would break those. Once every table is
-- either scoped or explicitly confirmed permissive-by-design, revoke it in
-- its own separate, reviewed migration.
-- ============================================================================

-- --- order_assignments -------------------------------------------------------
drop policy if exists order_assignments_all on public.order_assignments;
drop policy if exists order_assignments_select on public.order_assignments;
drop policy if exists order_assignments_write on public.order_assignments;

create policy order_assignments_select on public.order_assignments
  for select to authenticated
  using (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.order_assignments.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
  );

create policy order_assignments_write on public.order_assignments
  for all to authenticated
  using (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.order_assignments.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  )
  with check (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.order_assignments.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

-- --- repair_order_parts -------------------------------------------------------
drop policy if exists repair_order_parts_all on public.repair_order_parts;
drop policy if exists repair_order_parts_select on public.repair_order_parts;
drop policy if exists repair_order_parts_write on public.repair_order_parts;

create policy repair_order_parts_select on public.repair_order_parts
  for select to authenticated
  using (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_parts.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
  );

create policy repair_order_parts_write on public.repair_order_parts
  for all to authenticated
  using (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_parts.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  )
  with check (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_parts.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

-- --- repair_order_comms -------------------------------------------------------
drop policy if exists repair_order_comms_all on public.repair_order_comms;
drop policy if exists repair_order_comms_select on public.repair_order_comms;
drop policy if exists repair_order_comms_write on public.repair_order_comms;

create policy repair_order_comms_select on public.repair_order_comms
  for select to authenticated
  using (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_comms.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
  );

create policy repair_order_comms_write on public.repair_order_comms
  for all to authenticated
  using (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_comms.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  )
  with check (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_comms.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

-- --- repair_order_invoices ----------------------------------------------------
drop policy if exists repair_order_invoices_all on public.repair_order_invoices;
drop policy if exists repair_order_invoices_select on public.repair_order_invoices;
drop policy if exists repair_order_invoices_write on public.repair_order_invoices;

create policy repair_order_invoices_select on public.repair_order_invoices
  for select to authenticated
  using (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_invoices.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
  );

create policy repair_order_invoices_write on public.repair_order_invoices
  for all to authenticated
  using (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_invoices.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  )
  with check (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_invoices.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

-- --- repair_order_supplements --------------------------------------------------
drop policy if exists repair_order_supplements_all on public.repair_order_supplements;
drop policy if exists repair_order_supplements_select on public.repair_order_supplements;
drop policy if exists repair_order_supplements_write on public.repair_order_supplements;

create policy repair_order_supplements_select on public.repair_order_supplements
  for select to authenticated
  using (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_supplements.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
  );

create policy repair_order_supplements_write on public.repair_order_supplements
  for all to authenticated
  using (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_supplements.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  )
  with check (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_supplements.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

-- --- repair_order_labor -------------------------------------------------------
drop policy if exists repair_order_labor_all on public.repair_order_labor;
drop policy if exists repair_order_labor_select on public.repair_order_labor;
drop policy if exists repair_order_labor_write on public.repair_order_labor;

create policy repair_order_labor_select on public.repair_order_labor
  for select to authenticated
  using (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_labor.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
  );

create policy repair_order_labor_write on public.repair_order_labor
  for all to authenticated
  using (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_labor.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  )
  with check (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_labor.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

-- --- purchase_orders ----------------------------------------------------------
-- One-hop, direct: purchase_orders.repair_order_id -> repair_orders (added by
-- 20260730000000_inventory_lockdown.sql, replacing the old claim_number link).
drop policy if exists purchase_orders_all on public.purchase_orders;
drop policy if exists purchase_orders_select on public.purchase_orders;
drop policy if exists purchase_orders_write on public.purchase_orders;

create policy purchase_orders_select on public.purchase_orders
  for select to authenticated
  using (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.purchase_orders.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
  );

create policy purchase_orders_write on public.purchase_orders
  for all to authenticated
  using (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.purchase_orders.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  )
  with check (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.purchase_orders.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

-- --- purchase_order_items ------------------------------------------------------
-- Two-hop: purchase_order_items.po_id -> purchase_orders.repair_order_id ->
-- repair_orders.organization_id. No organization_id or repair_order_id of
-- its own.
drop policy if exists purchase_order_items_all on public.purchase_order_items;
drop policy if exists purchase_order_items_select on public.purchase_order_items;
drop policy if exists purchase_order_items_write on public.purchase_order_items;

create policy purchase_order_items_select on public.purchase_order_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.purchase_orders po
      join public.repair_orders ro on ro.id = po.repair_order_id
      where po.id = public.purchase_order_items.po_id
        and ro.organization_id = public.current_user_org_id()
    )
  );

create policy purchase_order_items_write on public.purchase_order_items
  for all to authenticated
  using (
    exists (
      select 1
      from public.purchase_orders po
      join public.repair_orders ro on ro.id = po.repair_order_id
      where po.id = public.purchase_order_items.po_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  )
  with check (
    exists (
      select 1
      from public.purchase_orders po
      join public.repair_orders ro on ro.id = po.repair_order_id
      where po.id = public.purchase_order_items.po_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

-- --- commission_overrides ------------------------------------------------------
-- Direct organization_id column (nullable) — no join needed. Preserves the
-- table's existing, distinct 4-policy shape and its EXECUTIVE-only write gate
-- (already established in 20260730010000_catastrophe_hub.sql); adds org
-- scoping on top rather than adopting the TECH/ADJUSTER/MANAGER/EXECUTIVE
-- write-role set used above, since that would loosen an already-tighter rule.
-- A row with organization_id IS NULL matches no one's org and is invisible to
-- everyone (fails closed).
drop policy if exists commission_overrides_select on public.commission_overrides;
drop policy if exists commission_overrides_insert on public.commission_overrides;
drop policy if exists commission_overrides_update on public.commission_overrides;
drop policy if exists commission_overrides_delete on public.commission_overrides;

create policy commission_overrides_select on public.commission_overrides
  for select to authenticated
  using (organization_id = public.current_user_org_id());

create policy commission_overrides_insert on public.commission_overrides
  for insert to authenticated
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_is('EXECUTIVE')
  );

create policy commission_overrides_update on public.commission_overrides
  for update to authenticated
  using (
    organization_id = public.current_user_org_id()
    and public.current_user_is('EXECUTIVE')
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_is('EXECUTIVE')
  );

create policy commission_overrides_delete on public.commission_overrides
  for delete to authenticated
  using (
    organization_id = public.current_user_org_id()
    and public.current_user_is('EXECUTIVE')
  );
