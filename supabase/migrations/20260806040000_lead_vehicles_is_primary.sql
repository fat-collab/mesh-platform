-- ============================================================================
-- MESH — lead_vehicles.is_primary
--
-- Isolated, minimal slice of the fan-out design (20260801070000, unapplied —
-- see 20260806030000's correction) pulled forward because vehicle_documents
-- needs it: every lead-creation path is about to start writing a
-- lead_vehicles row for the primary vehicle synchronously (2b), and without
-- a flag, that row is indistinguishable from an additional household
-- vehicle's row.
--
-- Deliberately NOT included: claim_number, policy_number. Those belong to
-- the agreement/fan-out work (per-vehicle claim attribution once a
-- household lead's vehicles each become their own RO) and have nothing to
-- do with attaching documents to a vehicle. Pulling them in would repeat
-- the reach-ahead 20260806030000 was corrected for, just at smaller scale.
-- ============================================================================

alter table public.lead_vehicles
  add column if not exists is_primary boolean not null default false;

create unique index if not exists lead_vehicles_primary_unique
  on public.lead_vehicles (lead_id)
  where is_primary;
