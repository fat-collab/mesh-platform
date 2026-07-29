-- ============================================================================
-- MESH Ops — repair_order_supplements
--
-- RO-scoped supplement ledger: one RO → many supplements, each with an amount,
-- adjuster contact, and a lifecycle (Draft → Submitted → Approved / Denied).
-- Drives the drawer's approved / pending financial totals. Distinct from the
-- claim-scoped supplement_records / parts_line_items layers.
--
-- NOTE: policies are permissive for the demo (the browser client uses a
-- service-role key that bypasses RLS anyway). Tighten with org scoping before
-- production.
-- ============================================================================

create table if not exists public.repair_order_supplements (
  id                uuid primary key default gen_random_uuid(),
  repair_order_id   uuid not null references public.repair_orders(id) on delete cascade,
  supplement_number text not null,
  status            text not null default 'DRAFT'
    check (status in ('DRAFT','SUBMITTED','APPROVED','DENIED')),
  amount            numeric(12,2) not null default 0,
  adjuster_name     text,
  adjuster_phone    text,
  notes             text,
  submitted_at      timestamptz,
  approved_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists repair_order_supplements_ro_idx
  on public.repair_order_supplements (repair_order_id);

alter table public.repair_order_supplements enable row level security;
drop policy if exists repair_order_supplements_all on public.repair_order_supplements;
create policy repair_order_supplements_all on public.repair_order_supplements
  for all to authenticated, anon using (true) with check (true);
