-- ============================================================================
-- MESH Ops — repair order financial closeout.
--
-- Adds the closeout markers the Financial Clearance Gate sets once an RO clears
-- all financial checks (deductible collected, insurance cleared, parts
-- reconciled, supplements settled): closed_at + financial_status ('closed_paid').
-- ============================================================================

alter table public.repair_orders
  add column if not exists closed_at timestamptz;

alter table public.repair_orders
  add column if not exists financial_status text
    check (financial_status is null or financial_status in ('open','closed_paid'));

create index if not exists repair_orders_financial_status_idx
  on public.repair_orders (financial_status);
