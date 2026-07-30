-- ============================================================================
-- MESH Sales — Hail-Optimized Catastrophe Lead Aggregator & Dispatch Hub
--
-- Additive columns on intake_leads for the dual-tab hub (Digital Inbound &
-- Storm Triage / Field Agent Dispatch): storm/zip attribution, an instant
-- digital-intake severity rating, damage photo capture, and the post-contact
-- dual-path routing + field-dispatch lifecycle. Plus commission_overrides,
-- the executive-controlled dynamic configuration layer over
-- payout_splits.tech_split_pct (SALES role legs).
-- ============================================================================

alter table public.intake_leads
  add column if not exists channel text
    check (channel is null or channel in ('DIGITAL_INBOUND', 'FIELD_DISPATCH')),
  add column if not exists storm_tag text,
  add column if not exists zip_code text,
  add column if not exists severity text
    check (severity is null or severity in ('MINOR', 'MODERATE', 'SEVERE', 'CATASTROPHIC')),
  add column if not exists damage_photos jsonb not null default '[]'::jsonb,
  add column if not exists routing_path text
    check (routing_path is null or routing_path in ('SHOP_DROPOFF', 'MOBILE_HOUSE_CALL')),
  add column if not exists dispatch_staff_name text,
  add column if not exists dispatch_status text
    check (dispatch_status is null or dispatch_status in ('DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'COMPLETED'));

create index if not exists intake_leads_channel_idx on public.intake_leads (channel);

-- Existing leads predate the dual-tab hub and were sourced as web/social
-- inbound — default them into the Digital Inbound tab rather than leaving
-- channel null (which would otherwise orphan them from both tabs).
update public.intake_leads set channel = 'DIGITAL_INBOUND' where channel is null;

-- ----------------------------------------------------------------------------
-- commission_overrides — executive-controlled override of a SALES payout
-- split's tech_split_pct, scoped to either a specific rep (user_id) or a
-- specific RO deal (ro_id). Both columns are plain text, not FKs: staff
-- records in this app are free-text ids (e.g. 'staff-avery', assigned via
-- LeadOwnerChip/assignLeadStaff) and repair orders created through the local/
-- demo bridge carry non-uuid ids (e.g. 'mock-a6f1') — neither would satisfy a
-- strict uuid FK, the same class of mismatch already worked around for
-- intake_leads.id.
-- ----------------------------------------------------------------------------
create table if not exists public.commission_overrides (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid references public.organizations(id) on delete cascade,
  user_id           text,
  ro_id             text,
  split_role        public.payout_split_role not null default 'SALES',
  override_pct      numeric(5,2) not null check (override_pct between 0 and 100),
  set_by            text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint commission_overrides_scope_chk check (user_id is not null or ro_id is not null)
);

create index if not exists commission_overrides_user_idx on public.commission_overrides (user_id);
create index if not exists commission_overrides_ro_idx on public.commission_overrides (ro_id);

alter table public.commission_overrides enable row level security;

-- Reporting is broadly readable (matches the permissive demo posture used by
-- intake_leads etc.); writes are executive-only.
drop policy if exists commission_overrides_select on public.commission_overrides;
create policy commission_overrides_select on public.commission_overrides
  for select to authenticated, anon using (true);

drop policy if exists commission_overrides_insert on public.commission_overrides;
create policy commission_overrides_insert on public.commission_overrides
  for insert to authenticated with check (public.current_user_is('EXECUTIVE'));

drop policy if exists commission_overrides_update on public.commission_overrides;
create policy commission_overrides_update on public.commission_overrides
  for update to authenticated
  using (public.current_user_is('EXECUTIVE'))
  with check (public.current_user_is('EXECUTIVE'));

drop policy if exists commission_overrides_delete on public.commission_overrides;
create policy commission_overrides_delete on public.commission_overrides
  for delete to authenticated using (public.current_user_is('EXECUTIVE'));
