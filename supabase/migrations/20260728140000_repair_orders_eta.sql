-- ============================================================================
-- MESH — repair order target delivery ETA
--
-- Repair completion ETA, compared against rental policy expiry in the Fleet &
-- Rentals tracker (policy-days-left vs. days-to-completion countdown).
-- ============================================================================

alter table public.repair_orders
  add column if not exists target_delivery_date timestamptz;
