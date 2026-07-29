-- ============================================================================
-- MESH Ops — repair_order_parts
--
-- Parts procurement for an active repair order: one RO → many parts, each with
-- a sourcing type (OEM / Aftermarket / Salvage / Used) and a procurement
-- lifecycle (Needed → Ordered → Shipped → Received / Returned). RO-scoped and
-- distinct from the claim-scoped parts_line_items estimate/discrepancy layer.
--
-- NOTE: policies are permissive for the demo (the browser client uses a
-- service-role key that bypasses RLS anyway). Tighten with org scoping before
-- production.
-- ============================================================================

create table if not exists public.repair_order_parts (
  id               uuid primary key default gen_random_uuid(),
  repair_order_id  uuid not null references public.repair_orders(id) on delete cascade,
  part_name        text not null,
  part_number      text,
  vendor           text,
  part_type        text not null default 'OEM'
    check (part_type in ('OEM','AFTERMARKET','SALVAGE','USED')),
  status           text not null default 'NEEDED'
    check (status in ('NEEDED','ORDERED','SHIPPED','RECEIVED','RETURNED')),
  cost             numeric(12,2) not null default 0,
  eta              text,
  created_at       timestamptz not null default now()
);

create index if not exists repair_order_parts_ro_idx
  on public.repair_order_parts (repair_order_id);

alter table public.repair_order_parts enable row level security;
drop policy if exists repair_order_parts_all on public.repair_order_parts;
create policy repair_order_parts_all on public.repair_order_parts
  for all to authenticated, anon using (true) with check (true);
