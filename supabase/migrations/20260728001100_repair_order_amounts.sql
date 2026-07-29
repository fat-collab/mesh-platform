-- ============================================================================
-- MESH Ops — repair order settlement amounts.
--
-- Inputs for the closeout Financial Clearance Gate's insurance-ledger check:
--   net insurance liability = final_approved_amount - customer_deductible
-- Compared against the sum of CLEARED insurance_payments for the RO.
-- ============================================================================

alter table public.repair_orders
  add column if not exists final_approved_amount numeric(12,2) not null default 0;

alter table public.repair_orders
  add column if not exists customer_deductible numeric(12,2) not null default 0;
