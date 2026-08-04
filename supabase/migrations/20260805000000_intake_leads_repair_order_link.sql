-- ============================================================================
-- MESH — durable intake_leads -> repair_orders link
--
-- Fixes the duplicate-RO bug found during sales-rep-ownership testing:
-- bridgeIntakeToOps (saveIntakePackage's eager RO creation at intake) and
-- convertLeadToRO's real DB-flow (the AOB-signed auto-convert / manual
-- convert path) each independently create a repair_orders row for the same
-- lead, with nothing durable connecting the two. The only thing that
-- previously prevented a duplicate insert was leadRoMap, an in-memory,
-- per-process Map — it does not survive across sessions/processes, so a
-- convertLeadToRO call from a *different* runtime than the one that ran
-- bridgeIntakeToOps (confirmed live: a Route Handler call, vs. the browser
-- tab that originally saved the lead) had no way to know an RO already
-- existed, and collided with repair_orders_org_claim_unique.
--
-- This column is the durable source of truth both paths now check before
-- inserting: if already set, adopt the existing RO instead of creating a
-- second one.
-- ============================================================================

alter table public.intake_leads
  add column repair_order_id uuid references public.repair_orders(id) on delete set null;

-- A repair_order is claimed by at most one lead. Partial (excludes null) so
-- leads that haven't bridged to an RO yet don't collide with each other.
create unique index if not exists idx_intake_leads_repair_order_id_unique
  on public.intake_leads (repair_order_id)
  where repair_order_id is not null;
