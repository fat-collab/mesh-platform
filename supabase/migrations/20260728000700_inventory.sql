-- ============================================================================
-- MESH Inventory — vendor & parts inventory management.
--
-- Suppliers, a parts catalog with stock levels, a supplier×part price matrix,
-- and purchase orders with line items. Distinct from the RO-scoped
-- repair_order_parts procurement layer (that is per-job; this is shop inventory).
--
-- NOTE: policies are permissive for the demo (the browser client uses a
-- service-role key that bypasses RLS anyway). Tighten with org scoping before
-- production.
-- ============================================================================

-- The full migration set was previously applied to this remote (history since
-- wiped), leaving stale inventory tables with a drifted schema (e.g.
-- purchase_order_items without po_id). Drop the inventory set so this migration
-- owns the current schema. These are demo-only procurement tables (no auth/init
-- data), dropped in reverse-dependency order; cascade clears any dependents.
drop table if exists public.purchase_order_items cascade;
drop table if exists public.purchase_orders cascade;
drop table if exists public.supplier_parts cascade;
drop table if exists public.parts_catalog cascade;
drop table if exists public.suppliers cascade;

create table if not exists public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  contact        text,
  lead_time_days int not null default 0
);

create table if not exists public.parts_catalog (
  id             uuid primary key default gen_random_uuid(),
  sku            text unique not null,
  name           text not null,
  category       text,
  min_stock      int not null default 0,
  current_stock  int not null default 0
);

create table if not exists public.supplier_parts (
  supplier_id     uuid not null references public.suppliers(id) on delete cascade,
  part_id         uuid not null references public.parts_catalog(id) on delete cascade,
  supplier_sku    text,
  wholesale_price numeric(12,2) not null default 0,
  preferred       boolean not null default false,
  primary key (supplier_id, part_id)
);

create table if not exists public.purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id) on delete set null,
  status      text not null default 'DRAFT'
    check (status in ('DRAFT','SENT','RECEIVED')),
  created_at  timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id         uuid primary key default gen_random_uuid(),
  po_id      uuid not null references public.purchase_orders(id) on delete cascade,
  part_id    uuid references public.parts_catalog(id) on delete set null,
  quantity   int not null default 1,
  unit_price numeric(12,2) not null default 0
);

-- --- indexes on FKs ---------------------------------------------------------
create index if not exists supplier_parts_supplier_idx on public.supplier_parts (supplier_id);
create index if not exists supplier_parts_part_idx on public.supplier_parts (part_id);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders (supplier_id);
create index if not exists purchase_order_items_po_idx on public.purchase_order_items (po_id);
create index if not exists purchase_order_items_part_idx on public.purchase_order_items (part_id);

-- --- permissive RLS ---------------------------------------------------------
alter table public.suppliers enable row level security;
alter table public.parts_catalog enable row level security;
alter table public.supplier_parts enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

drop policy if exists suppliers_all on public.suppliers;
create policy suppliers_all on public.suppliers
  for all to authenticated, anon using (true) with check (true);

drop policy if exists parts_catalog_all on public.parts_catalog;
create policy parts_catalog_all on public.parts_catalog
  for all to authenticated, anon using (true) with check (true);

drop policy if exists supplier_parts_all on public.supplier_parts;
create policy supplier_parts_all on public.supplier_parts
  for all to authenticated, anon using (true) with check (true);

drop policy if exists purchase_orders_all on public.purchase_orders;
create policy purchase_orders_all on public.purchase_orders
  for all to authenticated, anon using (true) with check (true);

drop policy if exists purchase_order_items_all on public.purchase_order_items;
create policy purchase_order_items_all on public.purchase_order_items
  for all to authenticated, anon using (true) with check (true);
