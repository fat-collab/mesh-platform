-- ============================================================================
-- MESH Procurement — bridge purchase orders to repair orders & their parts.
--
-- Extends the inventory PO tables so a purchase order can be raised directly
-- from a repair order's un-ordered parts (parts_line_items):
--   * purchase_orders.claim_number   → the RO the PO serves (matches
--     repair_orders.claim_number, same key parts_line_items uses).
--   * purchase_order_items.part_line_id → the specific parts_line_items row the
--     line fulfills (nullable; catalog-based lines leave it null).
-- ============================================================================

alter table public.purchase_orders
  add column if not exists claim_number text;

create index if not exists purchase_orders_claim_idx
  on public.purchase_orders (claim_number);

alter table public.purchase_order_items
  add column if not exists part_line_id uuid
    references public.parts_line_items(id) on delete set null;

create index if not exists purchase_order_items_part_line_idx
  on public.purchase_order_items (part_line_id);
