-- ============================================================================
-- MESH Platform — Initial Schema
-- Migration: 20260101000000_init_mesh
--
-- Multi-tenant collision/PDR repair management platform.
-- Tenancy model: every domain row carries `organization_id`; RLS isolates
-- tenants by matching that column against the caller's organization (resolved
-- from `auth.uid()` via SECURITY DEFINER helpers). The Supabase `service_role`
-- has BYPASSRLS and is used for privileged server-side work (Stripe payouts,
-- Gemini vision writes, OCR ingestion).
--
-- FILE ORDER (strict dependency order — do not reorder):
--   1. Extensions
--   2. Enums (CREATE TYPE)
--   3. Tables (CREATE TABLE)          <- all relations exist after this section
--   4. Functions (RLS helpers + trigger fns; reference tables from section 3)
--   5. Triggers
--   6. Indexes
--   7. Row Level Security (enable + policies)
--   8. Grants
--   9. Comments
--
-- NOTE ON EXTRA COLUMNS: CLAUDE.md lists the *minimum* required columns. This
-- migration adds `organization_id` to `vehicles` and to every RO-child table
-- so tenant isolation is enforceable with a single uniform RLS predicate, plus
-- `updated_at`, `created_at`, and a few operational columns. Child-table
-- `organization_id` is auto-derived from the parent repair order via trigger.
-- ============================================================================

-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================

create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ============================================================================
-- 2. ENUMS
-- ============================================================================

create type public.user_role as enum (
  'TECH', 'MANAGER', 'ADJUSTER', 'CUSTOMER', 'EXECUTIVE'
);

create type public.ro_stage as enum (
  'INTAKE',
  'TEARDOWN',
  'HOLD_CARRIER',
  'PDR_REPAIR',
  'HOLD_PARTS',
  'ADAS_SUBLET',
  'HOLD_TOTAL_LOSS',
  'QC_DELIVERY'
);

create type public.hold_gate_type as enum (
  'CARRIER_SUPPLEMENT',
  'PARTS_BACKORDER',
  'TOTAL_LOSS_REBUTTAL'
);

create type public.payout_status as enum (
  'PENDING',      -- split row created, awaiting PoP verification
  'PROCESSING',   -- Stripe transfer initiated
  'PAID',         -- Stripe transfer succeeded
  'FAILED',       -- Stripe transfer failed
  'REVERSED'      -- transfer reversed / refunded
);

-- Distinguishes the three legs of the 1099 split ledger (50/10/40 rule).
create type public.payout_split_role as enum (
  'PDR_LEAD',  -- 50% PDR Lead Tech
  'SALES',     -- 10% Sales
  'HOUSE'      -- 40% House
);

-- ============================================================================
-- 3. TABLES  (strict dependency order)
-- ============================================================================

-- --- organizations ---------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- --- locations --------------------------------------------------------------
create table public.locations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 200),
  address          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- --- users ------------------------------------------------------------------
-- Application-level user profile keyed to a Supabase auth user.
create table public.users (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid not null unique references auth.users(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  role             public.user_role not null default 'TECH',
  full_name        text,
  email            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- --- vehicles ---------------------------------------------------------------
-- organization_id added for tenant isolation; VIN is unique per organization.
create table public.vehicles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  vin              text check (vin is null or char_length(vin) <= 17),
  make             text,
  model            text,
  year             smallint check (year is null or year between 1900 and 2100),
  paint_code       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint vehicles_org_vin_unique unique (organization_id, vin)
);

-- --- repair_orders ----------------------------------------------------------
create table public.repair_orders (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  location_id      uuid references public.locations(id) on delete set null,
  vehicle_id       uuid references public.vehicles(id) on delete restrict,
  customer_name    text,
  claim_number     text,
  stage            public.ro_stage not null default 'INTAKE',
  hold_gate_active boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- --- total_loss_audits ------------------------------------------------------
-- risk_score is derived from the ACV rebuttal math (see compute_risk_score()).
create table public.total_loss_audits (
  id                   uuid primary key default gen_random_uuid(),
  ro_id                uuid not null references public.repair_orders(id) on delete cascade,
  organization_id      uuid not null,  -- auto-populated from parent RO
  acv_amount           numeric(12,2) check (acv_amount is null or acv_amount >= 0),
  conventional_estimate numeric(12,2) check (conventional_estimate is null or conventional_estimate >= 0),
  pdr_estimate         numeric(12,2) check (pdr_estimate is null or pdr_estimate >= 0),
  risk_score           numeric(12,4),
  state_threshold_pct  numeric(5,2) check (state_threshold_pct is null or state_threshold_pct between 0 and 100),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- --- hold_gate_logs ---------------------------------------------------------
create table public.hold_gate_logs (
  id               uuid primary key default gen_random_uuid(),
  ro_id            uuid not null references public.repair_orders(id) on delete cascade,
  organization_id  uuid not null,  -- auto-populated from parent RO
  gate_type        public.hold_gate_type not null,
  locked_at        timestamptz not null default now(),
  unlocked_at      timestamptz,
  resolved_by      uuid references public.users(id) on delete set null,
  resolution_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint hold_gate_logs_unlock_after_lock
    check (unlocked_at is null or unlocked_at >= locked_at)
);

-- --- proof_of_payments ------------------------------------------------------
create table public.proof_of_payments (
  id                uuid primary key default gen_random_uuid(),
  ro_id             uuid not null references public.repair_orders(id) on delete cascade,
  organization_id   uuid not null,  -- auto-populated from parent RO
  check_amount      numeric(12,2) check (check_amount is null or check_amount >= 0),
  check_image_url   text,
  ocr_verified_flag boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- --- payout_splits ----------------------------------------------------------
-- net_payout is derived: gross_amount * tech_split_pct / 100 (see trigger).
create table public.payout_splits (
  id                uuid primary key default gen_random_uuid(),
  ro_id             uuid not null references public.repair_orders(id) on delete cascade,
  organization_id   uuid not null,  -- auto-populated from parent RO
  tech_user_id      uuid references public.users(id) on delete set null,
  split_role        public.payout_split_role,
  gross_amount      numeric(12,2) not null check (gross_amount >= 0),
  tech_split_pct    numeric(5,2) not null check (tech_split_pct between 0 and 100),
  net_payout        numeric(12,2),
  stripe_transfer_id text,
  status            public.payout_status not null default 'PENDING',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ============================================================================
-- 4. FUNCTIONS
-- All tables now exist, so SQL-language functions that reference them (the RLS
-- helpers below) validate cleanly. No circular dependency: policies in
-- section 7 call these helpers, which read public.users (created in section 3).
-- ============================================================================

-- --- shared trigger helper ---------------------------------------------------
-- Touch updated_at on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- --- RLS helper functions ----------------------------------------------------
-- Resolve the caller's organization from their auth uid.
-- SECURITY DEFINER so it can read public.users without tripping that table's
-- own RLS (which would otherwise cause infinite recursion in policies).
create or replace function public.current_user_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.users
  where auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.users
  where auth_user_id = auth.uid()
  limit 1;
$$;

-- True when the caller holds any of the given roles.
create or replace function public.current_user_is(variadic roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where auth_user_id = auth.uid()
      and role = any(roles)
  );
$$;

-- --- domain trigger functions ------------------------------------------------

-- Keep repair_orders.hold_gate_active in sync with the stage. The HOLD_*
-- stages are, by definition, active hold gates (business rule C).
create or replace function public.sync_hold_gate_active()
returns trigger
language plpgsql
as $$
begin
  new.hold_gate_active :=
    new.stage in ('HOLD_CARRIER', 'HOLD_PARTS', 'HOLD_TOTAL_LOSS');
  return new;
end;
$$;

-- Validate that a repair order's vehicle and location belong to the same org.
create or replace function public.validate_ro_relations()
returns trigger
language plpgsql
as $$
begin
  if new.vehicle_id is not null then
    if not exists (
      select 1 from public.vehicles
      where id = new.vehicle_id and organization_id = new.organization_id
    ) then
      raise exception 'vehicle % does not belong to organization %',
        new.vehicle_id, new.organization_id;
    end if;
  end if;

  if new.location_id is not null then
    if not exists (
      select 1 from public.locations
      where id = new.location_id and organization_id = new.organization_id
    ) then
      raise exception 'location % does not belong to organization %',
        new.location_id, new.organization_id;
    end if;
  end if;

  return new;
end;
$$;

-- Derive organization_id on RO-child rows from their parent repair order.
-- Runs as INVOKER: the SELECT is subject to RLS, so a caller cannot attach a
-- child row to a repair order in another tenant (the lookup returns nothing).
create or replace function public.set_ro_child_org()
returns trigger
language plpgsql
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from public.repair_orders
  where id = new.ro_id;

  if v_org is null then
    raise exception 'repair_order % not found or not accessible', new.ro_id;
  end if;

  new.organization_id := v_org;
  return new;
end;
$$;

-- Compute the total-loss risk score:
--   Risk = Conventional Cost / (ACV * Threshold%)
-- threshold is stored as a percentage (e.g. 75.00 => 0.75).
create or replace function public.compute_risk_score()
returns trigger
language plpgsql
as $$
begin
  if new.acv_amount is null or new.acv_amount = 0
     or new.state_threshold_pct is null or new.state_threshold_pct = 0
     or new.conventional_estimate is null then
    new.risk_score := null;
  else
    new.risk_score := round(
      new.conventional_estimate / (new.acv_amount * (new.state_threshold_pct / 100.0)),
      4
    );
  end if;
  return new;
end;
$$;

-- Compute the net payout for a split leg: gross * pct / 100.
create or replace function public.compute_net_payout()
returns trigger
language plpgsql
as $$
begin
  new.net_payout := round(new.gross_amount * (new.tech_split_pct / 100.0), 2);
  return new;
end;
$$;

-- ============================================================================
-- 5. TRIGGERS
-- ============================================================================

-- --- updated_at wiring -------------------------------------------------------
create trigger trg_organizations_updated_at    before update on public.organizations    for each row execute function public.set_updated_at();
create trigger trg_locations_updated_at         before update on public.locations         for each row execute function public.set_updated_at();
create trigger trg_users_updated_at             before update on public.users             for each row execute function public.set_updated_at();
create trigger trg_vehicles_updated_at          before update on public.vehicles          for each row execute function public.set_updated_at();
create trigger trg_repair_orders_updated_at     before update on public.repair_orders     for each row execute function public.set_updated_at();
create trigger trg_total_loss_audits_updated_at before update on public.total_loss_audits for each row execute function public.set_updated_at();
create trigger trg_hold_gate_logs_updated_at    before update on public.hold_gate_logs    for each row execute function public.set_updated_at();
create trigger trg_proof_of_payments_updated_at before update on public.proof_of_payments for each row execute function public.set_updated_at();
create trigger trg_payout_splits_updated_at     before update on public.payout_splits     for each row execute function public.set_updated_at();

-- --- domain wiring -----------------------------------------------------------
create trigger trg_repair_orders_hold_gate
  before insert or update of stage on public.repair_orders
  for each row execute function public.sync_hold_gate_active();

create trigger trg_repair_orders_validate
  before insert or update of vehicle_id, location_id, organization_id on public.repair_orders
  for each row execute function public.validate_ro_relations();

create trigger trg_total_loss_audits_org
  before insert on public.total_loss_audits
  for each row execute function public.set_ro_child_org();
create trigger trg_hold_gate_logs_org
  before insert on public.hold_gate_logs
  for each row execute function public.set_ro_child_org();
create trigger trg_proof_of_payments_org
  before insert on public.proof_of_payments
  for each row execute function public.set_ro_child_org();
create trigger trg_payout_splits_org
  before insert on public.payout_splits
  for each row execute function public.set_ro_child_org();

create trigger trg_total_loss_audits_risk
  before insert or update of acv_amount, conventional_estimate, state_threshold_pct
  on public.total_loss_audits
  for each row execute function public.compute_risk_score();

create trigger trg_payout_splits_net
  before insert or update of gross_amount, tech_split_pct on public.payout_splits
  for each row execute function public.compute_net_payout();

-- ============================================================================
-- 6. INDEXES
-- ============================================================================

create index idx_locations_org             on public.locations (organization_id);

create index idx_users_org                 on public.users (organization_id);
create index idx_users_role                on public.users (organization_id, role);

create index idx_vehicles_org              on public.vehicles (organization_id);

create index idx_repair_orders_org         on public.repair_orders (organization_id);
create index idx_repair_orders_location    on public.repair_orders (location_id);
create index idx_repair_orders_vehicle     on public.repair_orders (vehicle_id);
create index idx_repair_orders_stage       on public.repair_orders (organization_id, stage);
create index idx_repair_orders_hold_active on public.repair_orders (organization_id) where hold_gate_active;

-- Claim numbers are unique within an organization (when present).
create unique index repair_orders_org_claim_unique
  on public.repair_orders (organization_id, claim_number)
  where claim_number is not null;

create index idx_total_loss_audits_ro      on public.total_loss_audits (ro_id);
create index idx_total_loss_audits_org     on public.total_loss_audits (organization_id);

create index idx_hold_gate_logs_ro         on public.hold_gate_logs (ro_id);
create index idx_hold_gate_logs_org        on public.hold_gate_logs (organization_id);
create index idx_hold_gate_logs_open       on public.hold_gate_logs (ro_id) where unlocked_at is null;

create index idx_proof_of_payments_ro      on public.proof_of_payments (ro_id);
create index idx_proof_of_payments_org     on public.proof_of_payments (organization_id);

create index idx_payout_splits_ro          on public.payout_splits (ro_id);
create index idx_payout_splits_org         on public.payout_splits (organization_id);
create index idx_payout_splits_tech        on public.payout_splits (tech_user_id);
create index idx_payout_splits_status      on public.payout_splits (organization_id, status);

-- A Stripe transfer id maps to exactly one split row.
create unique index payout_splits_transfer_unique
  on public.payout_splits (stripe_transfer_id)
  where stripe_transfer_id is not null;

-- ============================================================================
-- 7. ROW LEVEL SECURITY
--
-- Pattern per table:
--   * FOR SELECT  — any member of the owning organization.
--   * FOR ALL     — org membership AND a privileged role; governs
--                   INSERT/UPDATE/DELETE. (Permissive policies OR together;
--                   the FOR SELECT policy handles reads, the FOR ALL policy
--                   handles writes.)
-- The service_role bypasses RLS entirely for trusted server-side operations.
--
-- No circular dependency: every policy calls the SECURITY DEFINER helpers from
-- section 4, which read public.users (section 3) while bypassing RLS.
-- ============================================================================

alter table public.organizations     enable row level security;
alter table public.locations         enable row level security;
alter table public.users             enable row level security;
alter table public.vehicles          enable row level security;
alter table public.repair_orders     enable row level security;
alter table public.total_loss_audits enable row level security;
alter table public.hold_gate_logs    enable row level security;
alter table public.proof_of_payments enable row level security;
alter table public.payout_splits     enable row level security;

-- --- organizations ----------------------------------------------------------
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = public.current_user_org_id());

create policy organizations_update on public.organizations
  for update to authenticated
  using (id = public.current_user_org_id() and public.current_user_is('EXECUTIVE'))
  with check (id = public.current_user_org_id());
-- INSERT/DELETE of organizations is a service_role operation only.

-- --- locations --------------------------------------------------------------
create policy locations_select on public.locations
  for select to authenticated
  using (organization_id = public.current_user_org_id());

create policy locations_write on public.locations
  for all to authenticated
  using (organization_id = public.current_user_org_id() and public.current_user_is('MANAGER', 'EXECUTIVE'))
  with check (organization_id = public.current_user_org_id() and public.current_user_is('MANAGER', 'EXECUTIVE'));

-- --- users ------------------------------------------------------------------
create policy users_select on public.users
  for select to authenticated
  using (organization_id = public.current_user_org_id());

create policy users_write on public.users
  for all to authenticated
  using (organization_id = public.current_user_org_id() and public.current_user_is('MANAGER', 'EXECUTIVE'))
  with check (organization_id = public.current_user_org_id() and public.current_user_is('MANAGER', 'EXECUTIVE'));

-- --- vehicles ---------------------------------------------------------------
create policy vehicles_select on public.vehicles
  for select to authenticated
  using (organization_id = public.current_user_org_id());

create policy vehicles_write on public.vehicles
  for all to authenticated
  using (organization_id = public.current_user_org_id() and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE'))
  with check (organization_id = public.current_user_org_id() and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE'));

-- --- repair_orders ----------------------------------------------------------
create policy repair_orders_select on public.repair_orders
  for select to authenticated
  using (organization_id = public.current_user_org_id());

create policy repair_orders_write on public.repair_orders
  for all to authenticated
  using (organization_id = public.current_user_org_id() and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE'))
  with check (organization_id = public.current_user_org_id() and public.current_user_is('TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE'));

-- --- total_loss_audits ------------------------------------------------------
create policy total_loss_audits_select on public.total_loss_audits
  for select to authenticated
  using (organization_id = public.current_user_org_id());

create policy total_loss_audits_write on public.total_loss_audits
  for all to authenticated
  using (organization_id = public.current_user_org_id() and public.current_user_is('ADJUSTER', 'MANAGER', 'EXECUTIVE'))
  with check (organization_id = public.current_user_org_id() and public.current_user_is('ADJUSTER', 'MANAGER', 'EXECUTIVE'));

-- --- hold_gate_logs ---------------------------------------------------------
create policy hold_gate_logs_select on public.hold_gate_logs
  for select to authenticated
  using (organization_id = public.current_user_org_id());

create policy hold_gate_logs_write on public.hold_gate_logs
  for all to authenticated
  using (organization_id = public.current_user_org_id() and public.current_user_is('ADJUSTER', 'MANAGER', 'EXECUTIVE'))
  with check (organization_id = public.current_user_org_id() and public.current_user_is('ADJUSTER', 'MANAGER', 'EXECUTIVE'));

-- --- proof_of_payments ------------------------------------------------------
create policy proof_of_payments_select on public.proof_of_payments
  for select to authenticated
  using (organization_id = public.current_user_org_id());

create policy proof_of_payments_write on public.proof_of_payments
  for all to authenticated
  using (organization_id = public.current_user_org_id() and public.current_user_is('MANAGER', 'EXECUTIVE'))
  with check (organization_id = public.current_user_org_id() and public.current_user_is('MANAGER', 'EXECUTIVE'));

-- --- payout_splits ----------------------------------------------------------
-- Financial ledger: only managers/executives may mutate; Stripe transfer
-- execution itself runs under service_role.
create policy payout_splits_select on public.payout_splits
  for select to authenticated
  using (organization_id = public.current_user_org_id());

create policy payout_splits_write on public.payout_splits
  for all to authenticated
  using (organization_id = public.current_user_org_id() and public.current_user_is('MANAGER', 'EXECUTIVE'))
  with check (organization_id = public.current_user_org_id() and public.current_user_is('MANAGER', 'EXECUTIVE'));

-- ============================================================================
-- 8. GRANTS
-- RLS governs row visibility, but the roles still need base table privileges
-- and execute on the helper functions used inside the policies.
-- ============================================================================

grant usage on schema public to anon, authenticated;

grant execute on function public.current_user_org_id() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_is(public.user_role[]) to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;

-- ============================================================================
-- 9. TABLE / COLUMN COMMENTS
-- ============================================================================

comment on table public.organizations     is 'Top-level tenant. Every other domain row scopes to an organization.';
comment on table public.locations          is 'Physical shop/branch locations within an organization.';
comment on table public.users              is 'Application user profiles keyed 1:1 to Supabase auth.users.';
comment on table public.vehicles           is 'Vehicles under repair; VIN unique per organization.';
comment on table public.repair_orders      is '8-stage repair order. hold_gate_active is derived from stage.';
comment on table public.total_loss_audits  is 'ACV total-loss rebuttal math; risk_score derived from inputs.';
comment on table public.hold_gate_logs     is 'Audit trail of hold-gate lock/unlock events per repair order.';
comment on table public.proof_of_payments  is 'Uploaded check images + OCR-extracted amounts (Proof of Payment).';
comment on table public.payout_splits      is '1099 split ledger; net_payout derived; Stripe Connect transfers.';

comment on column public.repair_orders.hold_gate_active is 'Auto-maintained: true when stage is a HOLD_* stage.';
comment on column public.total_loss_audits.risk_score   is 'Auto-computed: conventional_estimate / (acv_amount * state_threshold_pct/100).';
comment on column public.total_loss_audits.state_threshold_pct is 'State total-loss threshold as a percentage (e.g. 75.00).';
comment on column public.payout_splits.net_payout       is 'Auto-computed: gross_amount * tech_split_pct / 100.';
