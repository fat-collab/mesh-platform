-- ============================================================================
-- MESH Sales — intake_leads: add organization_id (nullable), backfill,
-- rename vin -> vin_last8, add checklist_complete. MIGRATION A of 2 —
-- non-destructive. No deletes, no NOT NULL constraint, no RLS changes.
-- See 20260801040000_intake_leads_org_not_null_and_rls.sql for the
-- destructive follow-up (delete orphans, set not null, org-scoped RLS),
-- applied separately after reviewing this one's backfill results.
--
-- Backfill paths (see this session's analysis — 3/9 seed rows resolved
-- unambiguously against live data at the time):
--   1. assigned_staff_id -> public.users.organization_id, only when
--      assigned_staff_id is uuid-shaped (real signed-in reps set this to
--      auth.uid(); demo/seed data uses non-uuid placeholders like
--      'staff-avery' and is left unresolved by this path).
--   2. claim_number -> repair_orders.organization_id, only when every
--      repair_orders row sharing that claim_number agrees on exactly one
--      organization (an ambiguous claim_number — matching >1 org — is left
--      unresolved rather than guessed).
-- Rows resolved by neither become Migration B's delete candidates.
-- ============================================================================

alter table public.intake_leads
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

create index if not exists intake_leads_org_idx on public.intake_leads (organization_id);

-- --- backfill 1: assigned_staff_id -> users.organization_id -----------------
-- Filter (regex) and cast happen in the same CTE's WHERE/SELECT, in that
-- order — Postgres evaluates the WHERE predicate before projecting the
-- SELECT list per row, so the cast never runs against a non-uuid string.
-- Combining the regex test and the ::uuid cast directly in one WHERE/ON
-- clause (e.g. via AND) would NOT be safe: the planner is free to reorder
-- AND-ed predicates, and a reordered cast can still fire against invalid
-- input before the regex filter would have excluded it.
with staff_uuid_leads as (
  select id as lead_id, assigned_staff_id::uuid as staff_uuid
  from public.intake_leads
  where organization_id is null
    and assigned_staff_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
update public.intake_leads il
set organization_id = u.organization_id
from staff_uuid_leads sul
join public.users u on u.auth_user_id = sul.staff_uuid
where il.id = sul.lead_id;

-- --- backfill 2: claim_number -> repair_orders.organization_id -------------
-- Only claim_numbers where every matching repair_orders row agrees on a
-- single organization_id; ambiguous claim_numbers (matching >1 org) resolve
-- to nothing here and stay null.
--
-- Postgres has no min()/max() aggregate for uuid (confirmed on apply:
-- "function min(uuid) does not exist"). No aggregate over organization_id
-- is needed anyway: the having guard below already leaves, per claim_number,
-- a set of repair_orders rows that all share one organization_id — so
-- `select distinct claim_number, organization_id` over exactly that
-- pre-filtered set collapses to one row per claim_number on its own,
-- via plain equality (which uuid does support), not ordering/min/max.
with unambiguous_claims as (
  select claim_number
  from public.repair_orders
  where claim_number is not null
  group by claim_number
  having count(distinct organization_id) = 1
),
unambiguous_claim_orgs as (
  select distinct ro.claim_number, ro.organization_id
  from public.repair_orders ro
  join unambiguous_claims uc on uc.claim_number = ro.claim_number
)
update public.intake_leads il
set organization_id = uco.organization_id
from unambiguous_claim_orgs uco
where il.claim_number = uco.claim_number
  and il.organization_id is null;

-- --- vin -> vin_last8 --------------------------------------------------------
-- Every observed value in this environment is exactly 8 characters (see this
-- session's length-distribution query) — the column has only ever held the
-- last-8 fragment despite its bare `vin` name, matching the app-level
-- IntakeLead.vinLast8 field it's always mapped to.
alter table public.intake_leads rename column vin to vin_last8;

-- --- checklist_complete ------------------------------------------------------
-- New home for the carrier-checklist gate, moved out of the mobile wizard's
-- step-2 canProceed() and into convertLeadToRO (see sales-db.ts). Not backed
-- by application writes yet in this migration — the gate currently derives
-- completeness live from `documents` at conversion time rather than reading
-- this column. Added now so a future pass can denormalize/cache it without
-- another migration; defaults false and is not enforced by any constraint.
alter table public.intake_leads
  add column if not exists checklist_complete boolean not null default false;
