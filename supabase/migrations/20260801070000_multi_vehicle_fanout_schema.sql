-- ============================================================================
-- MESH Sales — multi-vehicle fan-out schema (design pass from this session's
-- read-only report). Adds the columns and the one real idempotency guard the
-- fan-out conversion path needs; does NOT touch convertLeadToRO, RLS, or any
-- component. File only — not applied.
--
-- Decisions this migration does not re-litigate (given, not derived here):
--   * repair_orders_org_claim_unique (organization_id, claim_number) stays —
--     carriers issue one claim per vehicle, so one RO per claim is correct.
--   * Claim numbers are stored whole per vehicle. No parsing/deriving
--     suffixes from a shared claim number.
--   * A policy number is the fallback identifier when no claim number
--     exists yet.
--   * The backfill must never guess which vehicle a lone claim number on
--     the parent lead belongs to once more than one vehicle is involved.
-- ============================================================================

-- --- 1. lead_vehicles: is_primary, claim_number, policy_number ---------------
alter table public.lead_vehicles
  add column if not exists is_primary boolean not null default false,
  add column if not exists claim_number text,
  add column if not exists policy_number text;

-- --- 2. intake_leads: policy_number -------------------------------------------
-- Already captured in IntakeSubmission.policyNumber (components/sales/
-- types.ts:286) and silently discarded — saveIntakePackage's insert never
-- references it (confirmed: zero occurrences of policyNumber/policy_number
-- in sales-db.ts before this migration). This column just gives it
-- somewhere to land; wiring the insert itself is a code change, not this
-- migration's job.
alter table public.intake_leads
  add column if not exists policy_number text;

-- --- 3. repair_orders: lead_vehicle_id + the real idempotency guard ----------
-- Nullable — not every RO comes from a lead (manual Ops-board creation,
-- pulled-in converted leads, etc.). The partial unique index is what
-- actually prevents a double conversion from creating duplicate ROs for the
-- same vehicle: a second INSERT attempting the same lead_vehicle_id fails
-- outright at the database, rather than relying on the in-memory leadRoMap
-- (per-process, lost on reload, and — being keyed by lead, not by vehicle —
-- structurally unable to guard N-per-lead anyway).
alter table public.repair_orders
  add column if not exists lead_vehicle_id uuid references public.lead_vehicles(id);

create unique index if not exists repair_orders_lead_vehicle_unique
  on public.repair_orders (lead_vehicle_id)
  where lead_vehicle_id is not null;

-- --- 4 + 5 + 7. Backfill primary vehicle rows, then claim/policy, with counts
do $$
declare
  leads_total int;
  leads_skipped_empty int;
  primary_rows_inserted int;
  claims_copied int;
  claims_left_blank int;
begin
  select count(*) into leads_total from public.intake_leads;

  select count(*) into leads_skipped_empty
  from public.intake_leads
  where vehicle_year is null
    and nullif(trim(vehicle_make), '') is null
    and nullif(trim(vehicle_model), '') is null
    and nullif(trim(vin_last8), '') is null;

  raise notice 'intake_leads processed: %', leads_total;
  raise notice 'leads skipped as empty (no vehicle_year/make/model/vin_last8 at all — no primary row created): %', leads_skipped_empty;

  -- Step 4: one is_primary lead_vehicles row per lead with at least one
  -- non-empty vehicle field. Guarded against re-run: skips any lead that
  -- already has an is_primary row (defensive idempotency — this migration
  -- is the only writer of is_primary=true rows, so on a first run this
  -- guard is a no-op, and on an accidental second run it prevents
  -- duplicating every primary row).
  insert into public.lead_vehicles (lead_id, vehicle_year, vehicle_make, vehicle_model, vin, is_primary)
  select il.id, il.vehicle_year, il.vehicle_make, il.vehicle_model, il.vin_last8, true
  from public.intake_leads il
  where (
    il.vehicle_year is not null
    or nullif(trim(il.vehicle_make), '') is not null
    or nullif(trim(il.vehicle_model), '') is not null
    or nullif(trim(il.vin_last8), '') is not null
  )
  and not exists (
    select 1 from public.lead_vehicles lv where lv.lead_id = il.id and lv.is_primary
  );
  get diagnostics primary_rows_inserted = row_count;
  raise notice 'lead_vehicles primary rows created: %', primary_rows_inserted;

  -- Step 5: claim_number / policy_number onto the primary row — ONLY for
  -- leads whose primary row is their ONLY lead_vehicles row (single-vehicle
  -- leads). See the migration's closing comment block for the full
  -- reasoning on why this is the safe cutoff.
  with single_vehicle_primary as (
    select lv.id as lead_vehicle_id, lv.lead_id
    from public.lead_vehicles lv
    where lv.is_primary
      and (select count(*) from public.lead_vehicles lv2 where lv2.lead_id = lv.lead_id) = 1
  )
  update public.lead_vehicles lv
  set claim_number = il.claim_number,
      policy_number = il.policy_number
  from single_vehicle_primary svp
  join public.intake_leads il on il.id = svp.lead_id
  where lv.id = svp.lead_vehicle_id
    and (il.claim_number is not null or il.policy_number is not null);
  get diagnostics claims_copied = row_count;
  raise notice 'primary rows with claim_number/policy_number copied from the parent lead (single-vehicle leads only): %', claims_copied;

  -- Multi-vehicle leads (>1 total lead_vehicles row) whose parent lead HAD a
  -- claim/policy number that was deliberately NOT copied, because there is
  -- no way to know which vehicle it belongs to.
  select count(*) into claims_left_blank
  from public.lead_vehicles lv
  join public.intake_leads il on il.id = lv.lead_id
  where lv.is_primary
    and (il.claim_number is not null or il.policy_number is not null)
    and (select count(*) from public.lead_vehicles lv2 where lv2.lead_id = lv.lead_id) > 1;
  raise notice 'primary rows left with blank claim_number/policy_number despite the parent lead having one — multi-vehicle leads, cannot safely attribute: %', claims_left_blank;
end $$;

-- --- 6. One vehicle, one claim, per lead --------------------------------------
-- Created after the backfill so it governs all future writes without
-- needing to validate against pre-existing data (lead_vehicles.claim_number
-- did not exist before step 1 of this same migration, so there is nothing
-- for it to conflict with yet).
create unique index if not exists lead_vehicles_lead_claim_unique
  on public.lead_vehicles (lead_id, claim_number)
  where claim_number is not null;
