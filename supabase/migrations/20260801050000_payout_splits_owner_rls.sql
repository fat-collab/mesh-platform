-- ============================================================================
-- MESH Payouts — owner-level RLS on payout_splits.
--
-- getCommissionLedger() (src/lib/commission-db.ts) already filters non-
-- executives down to their own rows in JS, but the underlying payout_splits
-- query — which already runs under the caller's own authenticated session —
-- still returns every rep's row over the wire before that JS filter ever
-- runs; a devtools/network inspection bypasses the JS-level fix entirely.
-- This closes it at the database.
--
-- Decision (given, not derived here): commission is owner-level. EXECUTIVE
-- sees the whole org, unchanged. Everyone else — MANAGER included, no
-- special case — sees only splits that are theirs.
--
-- File only. Not applied.
-- ============================================================================

-- --- current_user_id() --------------------------------------------------------
-- New helper, mirroring current_user_org_id()'s existing shape (same table,
-- same auth.uid() lookup, same SECURITY DEFINER reasoning: it must read
-- public.users without tripping that table's own RLS). Needed because
-- payout_splits.tech_user_id references public.users(id) — the app-level row
-- id — not auth.uid() directly; those are different uuids for the same
-- person, and comparing tech_user_id to auth.uid() directly would silently
-- never match.
create or replace function public.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.users
  where auth_user_id = auth.uid()
  limit 1;
$$;

-- --- payout_splits_select ------------------------------------------------------
-- payout_split_role has three values (PDR_LEAD, SALES, HOUSE), and only two
-- of them have an individual owner at all:
--   * PDR_LEAD — owner is tech_user_id, directly on this table. Compared
--     against current_user_id() (public.users.id), not auth.uid() (see
--     above) — payout_splits.tech_user_id and auth.uid() are different id
--     spaces for the same person.
--   * SALES — tech_user_id is always null for this role (confirmed: only
--     ever written for PDR_LEAD, in api/v1/payments/verify/route.ts:398).
--     The only identifier is order_assignments.staff_id (text, holding
--     auth.uid() as text for real reps), joined on
--     order_assignments.repair_order_id = payout_splits.ro_id, filtered to
--     role = 'SALES' specifically — matching only SALES rows, not letting a
--     rep's SALES assignment on a deal unlock that same RO's HOUSE row too.
--   * HOUSE — the shop's cut, not owed to any individual. No branch matches
--     it for non-executives; it stays EXECUTIVE-only, by design, not by
--     omission.
--
-- The order_assignments EXISTS subquery below is itself subject to
-- order_assignments' own RLS (order_assignments_select, from
-- 20260801020000_organization_scoped_rls.sql) — not bypassed just because
-- it's referenced from another table's policy. That policy is org-scoped
-- only (no staff match), and the caller already satisfies the same org
-- match on the outer payout_splits row, so it does not block this lookup.
drop policy if exists payout_splits_select on public.payout_splits;

create policy payout_splits_select on public.payout_splits
  for select to authenticated
  using (
    organization_id = public.current_user_org_id()
    and (
      public.current_user_is('EXECUTIVE')
      or (
        split_role = 'PDR_LEAD'
        and tech_user_id = public.current_user_id()
      )
      or (
        split_role = 'SALES'
        and exists (
          select 1 from public.order_assignments oa
          where oa.repair_order_id = payout_splits.ro_id
            and oa.role = 'SALES'
            and oa.staff_id = auth.uid()::text
        )
      )
    )
  );

-- --- payout_splits_write --------------------------------------------------------
-- Deliberately untouched. No DROP/CREATE below — "writes stay as they are"
-- is guaranteed by not referencing payout_splits_write at all, not by
-- recreating it identically.
