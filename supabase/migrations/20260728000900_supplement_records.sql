-- ============================================================================
-- MESH - supplement_records (canonical carrier supplement claims)
--
-- The single source of truth for carrier-facing supplements: payment lifecycle,
-- per-line items (jsonb: category / original vs requested cost / status / photo),
-- carrier notes, and adjuster contact. Consumed by the Supplements dashboard,
-- the RO drawer, invoicing, analytics, and the stage-gate financial-clearance
-- rule (via supplement-db.ts). Supersedes the deprecated RO-scoped
-- repair_order_supplements table.
--
-- ids are application-generated strings (genSupplementId  'supp-<uuid>'), so
-- the PK is text (mirrors intake_leads). ro_id is a loose reference (records may
-- predate a DB repair order), matched by ro_id or claim_number in the DAL.
--
-- NOTE: policies are permissive for the demo (the browser client uses a
-- service-role key that bypasses RLS anyway). Tighten with org scoping before
-- production.
-- ============================================================================

create table if not exists public.supplement_records (
  id                 text primary key,
  ro_id              text,
  customer_name      text not null,
  vehicle_info       text,
  insurance_carrier  text,
  claim_number       text,
  lifecycle_status   text not null default 'DRAFT'
    check (lifecycle_status in ('DRAFT','SUBMITTED','APPROVED_PENDING_PAYMENT','PAID')),
  items              jsonb not null default '[]'::jsonb,
  total_delta_amount numeric(12,2) not null default 0,
  carrier_notes      text,
  adjuster_name      text,
  adjuster_phone     text,
  created_at         timestamptz not null default now()
);

create index if not exists supplement_records_claim_idx
  on public.supplement_records (claim_number);
create index if not exists supplement_records_ro_idx
  on public.supplement_records (ro_id);
create index if not exists supplement_records_lifecycle_idx
  on public.supplement_records (lifecycle_status);

alter table public.supplement_records enable row level security;
drop policy if exists supplement_records_all on public.supplement_records;
create policy supplement_records_all on public.supplement_records
  for all to authenticated, anon using (true) with check (true);

-- Demo seed intentionally omitted: the Supabase CLI's raw-SQL migration parser
-- rejects this multi-row jsonb VALUES block (the schema is correct and runtime
-- parameterized inserts via supplement-db.ts work fine). The Supplements
-- dashboard renders sample data from src/lib/supplement-mock.ts as a fallback
-- whenever this table is empty, so no demo data is lost.
