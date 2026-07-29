-- ============================================================================
-- MESH Ops — repair_order_comms
--
-- RO-scoped customer communication log: one RO → many entries across SMS /
-- email / phone / internal note, inbound or outbound. Forms the customer-comms
-- timeline in the drawer.
--
-- NOTE: policies are permissive for the demo (the browser client uses a
-- service-role key that bypasses RLS anyway). Tighten with org scoping before
-- production.
-- ============================================================================

create table if not exists public.repair_order_comms (
  id               uuid primary key default gen_random_uuid(),
  repair_order_id  uuid not null references public.repair_orders(id) on delete cascade,
  channel          text not null
    check (channel in ('SMS','EMAIL','PHONE','NOTE')),
  direction        text not null default 'OUTBOUND'
    check (direction in ('INBOUND','OUTBOUND')),
  recipient        text,
  content          text not null,
  sender_name      text,
  created_at       timestamptz not null default now()
);

create index if not exists repair_order_comms_ro_idx
  on public.repair_order_comms (repair_order_id);

alter table public.repair_order_comms enable row level security;
drop policy if exists repair_order_comms_all on public.repair_order_comms;
create policy repair_order_comms_all on public.repair_order_comms
  for all to authenticated, anon using (true) with check (true);
