-- ============================================================================
-- MESH — grant the new SALES account role (public.user_role, added by
-- 20260801035000 / Migration C) access across the operational tables it
-- needs: works leads and intake, converts leads to ROs, never touches
-- financials. Runs after Migration C (enum value committed) and Migration B
-- (intake_leads/lead_vehicles already carry SALES on their write policies).
--
-- Every table touched below already has org-scoping from
-- 20260801020000_organization_scoped_rls.sql (or, for repair_orders/
-- vehicles, from the original init_mesh.sql policies) — that org predicate
-- is preserved unchanged everywhere; only the role list changes.
--
-- --- Full read + write (write-role set extended with SALES) -----------------
--   repair_order_comms — done below.
--   remote_aob_links, rental_vehicles — NOT done. See the warning block
--   before their section for why: both contradict this migration's stated
--   premise ("every table already has org-scoping to preserve").
--
-- --- Insert only, no update/delete -------------------------------------------
--   repair_orders, vehicles — split from a single `for all` _write policy
--   into _insert / _update / _delete, mirroring commission_overrides'
--   4-policy shape. SALES appears in _insert only. _select is untouched
--   (see note below — it was never role-restricted, so there's nothing to
--   add SALES to there).
--
-- --- Read only, no write ------------------------------------------------------
--   order_assignments, repair_order_parts, repair_order_labor,
--   repair_order_supplements — NO SQL below for these four, deliberately.
--   Their _select policies (from 20260801020000) already have no role
--   check at all — `using (exists (...org match...))`, full stop — so any
--   authenticated org member, SALES included once C lands, already reads
--   them with zero change needed. Their _write policies already exclude
--   SALES (TECH/ADJUSTER/MANAGER/EXECUTIVE only) and are left exactly as
--   they are, satisfying "no write" by construction. Writing a byte-
--   identical DROP+CREATE for either would be pure noise.
--
-- --- No access — untouched ----------------------------------------------------
--   repair_order_invoices, purchase_orders, purchase_order_items,
--   commission_overrides — no SQL below; not mentioned again.
-- ============================================================================

-- --- repair_order_comms --------------------------------------------------------
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
    and public.current_user_is('SALES', 'TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  )
  with check (
    exists (
      select 1 from public.repair_orders ro
      where ro.id = public.repair_order_comms.repair_order_id
        and ro.organization_id = public.current_user_org_id()
    )
    and public.current_user_is('SALES', 'TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

-- ============================================================================
-- WARNING — remote_aob_links and rental_vehicles are NOT touched below, and
-- were NOT part of the "full read + write" set applied above, despite being
-- named in the request. Both contradict this file's own preserve-the-org-
-- predicate premise: neither has an org predicate to preserve.
--
--   * remote_aob_links: its policy is `for all to authenticated, anon
--     using (true) with check (true)` (20260801000000_quick_lead_capture.sql
--     / legal_carrier_shield migration) — no organization_id, no org check,
--     BY DESIGN. Its own migration comment: "RLS is intentionally permissive
--     to anon: the whole point of this table is that an off-site proxy
--     policyholder — who has no MESH account — opens the link and signs
--     unauthenticated." Restricting it to `authenticated` + a role would
--     lock out the exact unauthenticated signer the table exists to serve.
--     Adding SALES to a role check here doesn't extend access — it would
--     newly EXCLUDE the anon proxy policyholder, breaking the feature.
--
--   * rental_vehicles: also still `for all to authenticated, anon
--     using (true) with check (true)` — deliberately left permissive by
--     20260801040000 (Migration B), for reasons recorded at length in that
--     file (shop inventory, not tenant data; no organization_id column; an
--     EXISTS-based policy through assigned_ro_id would break
--     getAvailableVehicles' loaner picker and assignVehicle's write path —
--     see that file's "NOT SCOPED, ON PURPOSE" block for the full evidence).
--     Nothing changed since that decision — no organization_id column
--     exists yet, assignVehicle still writes via the plain browser client.
--     Adding a role check now would require inventing org-scoping for this
--     table on the spot, which is exactly what that migration deferred to
--     its own future work.
--
-- Neither table's policy is modified by this migration. Flagging this
-- instead of silently complying, since applying either as literally
-- requested would either break the Remote AOB signing flow or resurrect the
-- Fleet-dashboard breakage already ruled out two migrations ago.
-- ============================================================================

-- --- repair_orders: split _write into _insert / _update / _delete -----------
-- _select is untouched — it was never role-restricted
-- (`using (organization_id = current_user_org_id())`, no current_user_is()
-- check at all), so SALES already reads repair_orders with zero change,
-- the same way it already reads the four "read only" tables above.
drop policy if exists repair_orders_write on public.repair_orders;
drop policy if exists repair_orders_insert on public.repair_orders;
drop policy if exists repair_orders_update on public.repair_orders;
drop policy if exists repair_orders_delete on public.repair_orders;

create policy repair_orders_insert on public.repair_orders
  for insert to authenticated
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_is('SALES', 'TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

create policy repair_orders_update on public.repair_orders
  for update to authenticated
  using (
    organization_id = public.current_user_org_id()
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

create policy repair_orders_delete on public.repair_orders
  for delete to authenticated
  using (
    organization_id = public.current_user_org_id()
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

-- --- vehicles: split _write into _insert / _update / _delete -----------------
-- Same reasoning as repair_orders above — _select untouched, never role-
-- restricted. Vehicle provisioning happens alongside repair_orders on
-- conversion (see sales-db.ts's convertLeadToRO), so SALES needs the same
-- insert access here.
drop policy if exists vehicles_write on public.vehicles;
drop policy if exists vehicles_insert on public.vehicles;
drop policy if exists vehicles_update on public.vehicles;
drop policy if exists vehicles_delete on public.vehicles;

create policy vehicles_insert on public.vehicles
  for insert to authenticated
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_is('SALES', 'TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

create policy vehicles_update on public.vehicles
  for update to authenticated
  using (
    organization_id = public.current_user_org_id()
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );

create policy vehicles_delete on public.vehicles
  for delete to authenticated
  using (
    organization_id = public.current_user_org_id()
    and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );
