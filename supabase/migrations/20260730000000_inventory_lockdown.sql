-- ============================================================================
-- MESH — Downstream Lockdown: inventory becomes a pure job-costing engine.
--
--  * Strips the generalized warehouse catalog: suppliers, parts_catalog,
--    supplier_parts, and purchase_order_items.part_id (which referenced the
--    catalog). No SKU/stock-level inventory concept remains — every part line
--    item must be tied to a specific repair order.
--  * purchase_orders.claim_number (a loose text link, added in po_ro_link) is
--    replaced by a real repair_order_id FK, plus a mandatory vin snapshot
--    (captured from the RO's vehicle at PO-creation time — an audit-accurate
--    record that doesn't drift if the vehicle row is edited later).
--  * Any pre-existing PO rows that predate this linkage cannot be job-costed
--    under the new rule and are removed rather than left orphaned/invalid.
-- ============================================================================

-- --- strip the warehouse catalog ---------------------------------------------
alter table public.purchase_order_items drop column if exists part_id;
drop table if exists public.supplier_parts cascade;
drop table if exists public.parts_catalog cascade;
drop table if exists public.suppliers cascade;

-- --- replace claim_number with a real RO + VIN linkage -----------------------
drop index if exists purchase_orders_claim_idx;

alter table public.purchase_orders
  add column if not exists repair_order_id uuid references public.repair_orders(id) on delete cascade;

alter table public.purchase_orders
  add column if not exists vin text;

-- Purge any PO (and its items) that can't satisfy the new mandatory linkage.
delete from public.purchase_order_items
  where po_id in (
    select id from public.purchase_orders
    where repair_order_id is null or vin is null or vin = ''
  );
delete from public.purchase_orders
  where repair_order_id is null or vin is null or vin = '';

alter table public.purchase_orders
  alter column repair_order_id set not null;
alter table public.purchase_orders
  alter column vin set not null;

alter table public.purchase_orders
  drop column if exists claim_number;

create index if not exists purchase_orders_repair_order_idx
  on public.purchase_orders (repair_order_id);
