-- ============================================================================
-- MESH Ops — repair_order_invoices
--
-- RO-scoped invoicing / accounts receivable: one invoice per RO, rolling up
-- base + parts + approved supplements + labor into subtotal / tax / total with a
-- payment lifecycle (Draft → Sent → Paid / Void).
--
-- NOTE: policies are permissive for the demo (the browser client uses a
-- service-role key that bypasses RLS anyway). Tighten with org scoping before
-- production.
-- ============================================================================

create table if not exists public.repair_order_invoices (
  id               uuid primary key default gen_random_uuid(),
  repair_order_id  uuid not null references public.repair_orders(id) on delete cascade,
  invoice_number   text not null,
  status           text not null default 'DRAFT'
    check (status in ('DRAFT','SENT','PAID','VOID')),
  subtotal         numeric(12,2) not null default 0,
  tax              numeric(12,2) not null default 0,
  total            numeric(12,2) not null default 0,
  paid_at          timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists repair_order_invoices_ro_idx
  on public.repair_order_invoices (repair_order_id);

alter table public.repair_order_invoices enable row level security;
drop policy if exists repair_order_invoices_all on public.repair_order_invoices;
create policy repair_order_invoices_all on public.repair_order_invoices
  for all to authenticated, anon using (true) with check (true);
