-- ============================================================================
-- MESH — vehicle_documents: one row per file, replacing the
-- intake_leads.documents/damage_photos jsonb-array design.
--
-- Design report is in this session's chat, not repeated in full here; the
-- short version: a hail job can produce hundreds of files per vehicle
-- (photos, estimates, supplements, receipts). A jsonb array on the parent
-- row means every one of those files is read on every query that touches
-- the row (including the sales board), with no pagination, no server-side
-- filtering, and no way to answer "which vehicles are missing four-corner
-- photos" without pulling every array and scanning it in application code.
-- This table gives indexed counts, checklist-status queries, and pagination
-- without ever fetching a payload the caller doesn't need.
--
-- Ownership: lead_vehicle_id, not lead_id or repair_order_id alone. Files
-- start at intake, before an RO exists, and lead_vehicles.id is the
-- earliest stable per-vehicle identifier this schema has.
--
-- CORRECTION: an earlier draft of this comment described lead_vehicles as
-- already having is_primary/claim_number/policy_number and repair_orders as
-- having lead_vehicle_id, attributing them to 20260801070000. That
-- migration file exists in the repo but was never applied — its own header
-- says "File only — not applied," and this session incorrectly assumed
-- otherwise. Confirmed live (information_schema, 2026-08-06):
-- lead_vehicles is exactly (id, lead_id, vehicle_year, vehicle_make,
-- vehicle_model, vin, severity, created_at) — no is_primary, no
-- claim_number, no policy_number; repair_orders has no lead_vehicle_id.
-- That fan-out work is a deliberately deferred design, not a dependency of
-- this table — vehicle_documents.lead_vehicle_id only needs a
-- lead_vehicles.id to reference, not any of the deferred columns.
--
-- Consequence, left open rather than silently redecided here: lead_vehicles
-- today only ever holds "vehicle #2+" (additional household vehicles) — the
-- primary vehicle lives solely on intake_leads' own vehicle_year/
-- vehicle_make/vehicle_model/vin_last8 columns, with no lead_vehicles row
-- of its own. The upload-path work (2b) needs to create one so
-- vehicle_documents has something to attach primary-vehicle uploads to,
-- but with no is_primary flag live, that row won't be distinguishable from
-- an additional vehicle's row. Not solved here.
--
-- repair_order_id is carried alongside lead_vehicle_id, nullable, meant to
-- be backfilled once at conversion time so Ops-side reads (RODetailDrawer,
-- invoice, proof-of-payment) can index on it directly without a join. Both
-- FKs are nullable; the check constraint requires at least one, since some
-- ROs never came from a lead at all (manual Ops-board creation).
--
-- organization_id is denormalized (copied at insert, never joined) for the
-- same reason lead_vehicles.claim_number/policy_number are: RLS evaluated
-- per-row against a table meant to hold hundreds of rows per vehicle can't
-- afford an EXISTS-through-two-tables subquery on every check.
--
-- `kind` is CHECK-constrained, not free text. Carrier-checklist completion
-- (getCarrierIntel().requiredChecklist, src/lib/carrier-intel.ts) compares
-- captured kinds against a fixed set drawn from IntakeDocKind
-- (src/components/sales/types.ts:254-264) — a typo in a kind value means a
-- required document silently never registers as captured, the same failure
-- shape as a carrier-name typo. Extensible by a small follow-up migration
-- when a new category is actually wired to an upload path — not
-- unconstrained now on the theory that something might need it later.
--
-- Included now: every existing IntakeDocKind value, plus INVOICE (RODetailDrawer's
-- blob-URL bug, already on the list to fix alongside the base64 producers)
-- and PROOF_OF_PAYMENT (path convention + Storage RLS already built in
-- 20260806020000). ESTIMATE, SUPPLEMENT_PHOTO, and RECEIPT were named in
-- this table's own design discussion as roadmap categories but have no
-- upload path wired yet anywhere in the app — reserved as valid values so
-- the eventual UI work doesn't also require a schema change, without
-- pretending they're built today.
--
-- PROOF_OF_PAYMENT read/write is gated the same way the Storage layer
-- already gates it (20260806020000): a check image's row here still carries
-- `amount` and `file_name` even though the bytes live in Storage, so the
-- same MANAGER/EXECUTIVE-only carve-out is applied at this table too —
-- otherwise this table would be a metadata side-channel around the Storage
-- RLS restriction, leaking check amounts to roles who can't see the image.
-- Same OR'd-policy reasoning as before: the general policies exclude
-- PROOF_OF_PAYMENT rows, and only the _pop_ policies can grant access to
-- them.
--
-- NOT part of this migration: application code, or any change to
-- lead_vehicles. None of saveIntakePackage/createDigitalLead/createQuickLead
-- create a lead_vehicles row for the primary vehicle today — see the
-- consequence noted above. That's 2b's problem to solve (and to decide
-- whether it needs an is_primary-equivalent flag, its own small migration
-- at that point), not something this migration reaches ahead to scaffold.
-- ============================================================================

-- --- vehicle_documents --------------------------------------------------------
create table public.vehicle_documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  lead_vehicle_id  uuid references public.lead_vehicles(id) on delete cascade,
  repair_order_id  uuid references public.repair_orders(id) on delete set null,
  kind             text not null check (kind in (
    -- IntakeDocKind (src/components/sales/types.ts:254-264) — wired today.
    'DL_FRONT', 'DL_BACK', 'INSURANCE_CARD', 'PRIOR_ESTIMATE', 'WALKAROUND',
    'DAMAGE_PHOTO', 'VIN_TO_DAMAGE_ALIGNMENT', 'LINE_BOARD_SWEEP',
    'FOUR_CORNER_PHOTOS', 'UNDERSIDE_BRACING_SHOTS',
    -- New, backed by plumbing already built this session.
    'INVOICE', 'PROOF_OF_PAYMENT',
    -- New, reserved for roadmap upload paths not yet wired to any code.
    'ESTIMATE', 'SUPPLEMENT_PHOTO', 'RECEIPT'
  )),
  file_name        text,
  storage_path     text not null,
  byte_size        bigint,
  mime_type        text,
  amount           numeric(12,2),
  uploaded_by      uuid references public.users(id),
  created_at       timestamptz not null default now(),
  constraint vehicle_documents_owner_check check (lead_vehicle_id is not null or repair_order_id is not null)
);

create index vehicle_documents_lead_vehicle_idx on public.vehicle_documents (lead_vehicle_id);
create index vehicle_documents_repair_order_idx on public.vehicle_documents (repair_order_id) where repair_order_id is not null;
create index vehicle_documents_kind_idx on public.vehicle_documents (lead_vehicle_id, kind);

alter table public.vehicle_documents enable row level security;

-- Any authenticated org member can read/list, except PROOF_OF_PAYMENT rows.
create policy vehicle_documents_select on public.vehicle_documents
  for select to authenticated
  using (
    organization_id = public.current_user_org_id()
    and kind <> 'PROOF_OF_PAYMENT'
  );

create policy vehicle_documents_pop_select on public.vehicle_documents
  for select to authenticated
  using (
    organization_id = public.current_user_org_id()
    and kind = 'PROOF_OF_PAYMENT'
    and public.current_user_is('MANAGER', 'EXECUTIVE')
  );

-- Same write role set as intake_leads_write/documents_write, except PROOF_OF_PAYMENT.
create policy vehicle_documents_write on public.vehicle_documents
  for all to authenticated
  using (
    organization_id = public.current_user_org_id()
    and public.current_user_is('SALES', 'TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
    and kind <> 'PROOF_OF_PAYMENT'
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_is('SALES', 'TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
    and kind <> 'PROOF_OF_PAYMENT'
  );

create policy vehicle_documents_pop_write on public.vehicle_documents
  for all to authenticated
  using (
    organization_id = public.current_user_org_id()
    and kind = 'PROOF_OF_PAYMENT'
    and public.current_user_is('MANAGER', 'EXECUTIVE')
  )
  with check (
    organization_id = public.current_user_org_id()
    and kind = 'PROOF_OF_PAYMENT'
    and public.current_user_is('MANAGER', 'EXECUTIVE')
  );
