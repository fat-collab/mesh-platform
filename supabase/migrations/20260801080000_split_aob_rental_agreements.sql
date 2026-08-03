-- ============================================================================
-- MESH Sales — split the repair AOB and the rental/loaner agreement into
-- distinct signature records, and add loaner-driver document capture.
--
-- Today both agreements share intake_leads.signature_url /
-- agreement_accepted: when a proxy takes a loaner but the main AOB is
-- deferred to the Remote AOB Execution Gate (policyholder_match = false),
-- the on-site signature captured for the RENTAL agreement gets written into
-- the same columns the main AOB uses — agreement_accepted flips true as if
-- the AOB were signed, when only the rental agreement actually was. This
-- migration adds separate rental_agreement_* columns; it does not attempt
-- to move or reclassify any existing signature (see the backfill section —
-- that would risk silently rewriting a legal record on a guess).
--
-- File only. Not applied. No RLS changes beyond enabling it (matching every
-- other table's own-creation convention) and mirroring rental_vehicles'
-- already-permissive, already-deferred-scoping posture for the one new
-- table this file adds — not introducing a new inconsistent policy shape
-- for a table this tightly coupled to it.
-- ============================================================================

-- --- 1. intake_leads: separate rental-agreement columns + the AOB timestamp -
-- agreement_accepted_at is already captured in IntakeSubmission
-- (components/sales/types.ts:302, set in MobileIntakeWizard.tsx:390) and
-- silently discarded — saveIntakePackage's insert never references it.
alter table public.intake_leads
  add column if not exists rental_agreement_signature_url text,
  add column if not exists rental_agreement_accepted boolean not null default false,
  add column if not exists rental_agreement_signed_at timestamptz,
  add column if not exists agreement_accepted_at timestamptz;

-- --- 2. Loaner driver capture -------------------------------------------------
-- New table, not columns on rental_vehicles: a vehicle is loaned repeatedly
-- to different drivers over its life (rental-db.ts's assignVehicle already
-- overwrites assigned_customer/assigned_agent on every new assignment,
-- losing the previous driver's info — putting driver identity directly on
-- the vehicle row would make that loss worse, not better, by also
-- overwriting license/insurance doc references on every reassignment).
-- One row per loan event instead: which vehicle, which lead, who actually
-- drove it (may differ from the AOB signer per this session's decision),
-- and references to their license/insurance documents — same plain-url
-- convention intake_leads.signature_url already uses, not a new jsonb
-- shape for two fields.
--
-- lead_id is plain text with NO FK constraint, deliberately, mirroring
-- remote_aob_links.lead_id's exact precedent: intake_leads.id is
-- app-generated text and locally-bridged/mock leads (e.g. 'mock-a6f1')
-- would not satisfy a strict FK. Same reasoning CLAUDE.md §6 item 4 already
-- gives for rental_vehicles.assigned_ro_id not being FK'd either.
create table if not exists public.rental_loan_drivers (
  id                      uuid primary key default gen_random_uuid(),
  rental_vehicle_id       text not null references public.rental_vehicles(id) on delete cascade,
  lead_id                 text,
  driver_name             text not null,
  license_document_url    text,
  insurance_document_url  text,
  created_at              timestamptz not null default now()
);

create index if not exists rental_loan_drivers_vehicle_idx
  on public.rental_loan_drivers (rental_vehicle_id);
create index if not exists rental_loan_drivers_lead_idx
  on public.rental_loan_drivers (lead_id);

alter table public.rental_loan_drivers enable row level security;
drop policy if exists rental_loan_drivers_all on public.rental_loan_drivers;
create policy rental_loan_drivers_all on public.rental_loan_drivers
  for all to authenticated, anon using (true) with check (true);

-- --- 3. Per-shop handover requirements ----------------------------------------
-- Which driver documents block key release vs merely warn. Defaults to
-- BLOCK for both, deliberately — a shop that never configures this is the
-- shop most likely to hand keys to an unlicensed or uninsured driver by
-- default. "No added friction" for a non-fleet shop is still satisfied:
-- this column is never read unless a loaner is actually being issued, so a
-- shop with no fleet never hits this gate regardless of its value. A shop
-- that wants WARN-only has to set it, not fall into it.
alter table public.organizations
  add column if not exists rental_handover_requirements jsonb not null default
    '{"driverLicense": "BLOCK", "proofOfInsurance": "BLOCK"}'::jsonb;

-- --- 4 + 5. Backfill: flag, never move ----------------------------------------
-- Cannot reliably identify which existing signatures were actually rental
-- signatures misfiled as the AOB. policyholder_match = false plus a loaner
-- on file is PROBABLE (it's exactly the code path that produces the bug —
-- MobileIntakeWizard's !policyholderMatch && provideLoaner && proxy-source
-- branch signs only the rental agreement, into the shared column), but not
-- certain: the same on-site rep could have separately confirmed AOB consent
-- some other way this schema doesn't capture, or the data could predate the
-- proxy/loaner feature entirely and mean something else. A wrong guess
-- here doesn't just mislabel a row — it rewrites which document a real
-- signature legally represents. So: no UPDATE ever touches signature_url,
-- agreement_accepted, or any of the new rental_agreement_* columns for
-- existing rows. The only write is a review flag.
--
-- Deliberately NOT flagged: policyholder_match = true leads with a loaner.
-- In that branch the on-site signature legitimately covers the AOB (the
-- wizard's own on-site flow bundles the rental agreement under the same
-- signature when the Named Insured is present) — nothing is mis-filed
-- there, the new rental_agreement_signature_url column just starts empty
-- for those rows going forward, which is a completeness gap, not a
-- correctness error, and doesn't need a human to adjudicate it.
alter table public.intake_leads
  add column if not exists signature_needs_review boolean not null default false;

do $$
declare
  total_leads int;
  ambiguous_flagged int;
begin
  select count(*) into total_leads from public.intake_leads;

  -- rental_vehicles.assigned_ro_id stores intake_leads.id values (CLAUDE.md
  -- §6 item 4) — joining it to repair_orders would be the documented
  -- mistake; this joins it to intake_leads, correctly.
  update public.intake_leads il
  set signature_needs_review = true
  where il.policyholder_match = false
    and il.signature_url is not null
    and exists (
      select 1 from public.rental_vehicles rv where rv.assigned_ro_id = il.id
    );
  get diagnostics ambiguous_flagged = row_count;

  raise notice 'intake_leads total rows: %', total_leads;
  raise notice 'rows flagged signature_needs_review (policyholder_match=false, signature_url present, loaner on file — signature_url may be a rental signature filed as the AOB): %', ambiguous_flagged;
  raise notice 'no signature_url, agreement_accepted, or rental_agreement_* value was moved or modified on any existing row.';
end $$;
