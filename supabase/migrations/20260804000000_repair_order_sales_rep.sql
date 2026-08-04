-- ============================================================================
-- MESH — repair_orders.sales_rep_id (sales-rep ownership key)
--
-- Chosen over deriving ownership from order_assignments: that table is
-- best-effort (assignStaff silently falls back to an in-memory store on any
-- DB error), free-text (staff_id has no FK to public.users), and today has
-- zero rows attributable to a real user — every existing SALES row was
-- seeded with a placeholder string ('staff-avery', 'staff-marcus',
-- 'staff-priya'), never a real auth.uid()-derived value. sales_rep_id is a
-- proper FK so "who owns this RO" has one authoritative, referentially
-- enforced answer.
-- ============================================================================

-- --- repair_orders.sales_rep_id ----------------------------------------------
alter table public.repair_orders
  add column sales_rep_id uuid references public.users(id) on delete set null;

create index if not exists idx_repair_orders_sales_rep
  on public.repair_orders (sales_rep_id);

-- NO BACKFILL. As of this migration, 0 of 14 existing repair_orders are
-- attributable to a real sales rep: 7 have no order_assignments SALES row at
-- all, and the other 7 carry only placeholder staff_id strings
-- ('staff-avery' x4, 'staff-marcus' x2, 'staff-priya' x1) that do not match
-- any public.users row. Guessing an owner from those strings (e.g. via
-- staff_name fuzzy-matching) would fabricate accountability data that never
-- existed. sales_rep_id is left null for all existing rows; only ROs created
-- going forward via the fixed application code path get a real value.

-- --- current_user_id() --------------------------------------------------------
-- Mirrors current_user_org_id() (20260101000000_init_mesh.sql): resolves the
-- caller's public.users.id from auth.uid(), for application code that needs
-- "which users row is this" rather than "which org is this".
create or replace function public.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.users
  where auth_user_id = auth.uid()
  limit 1;
$$;

-- No RLS changes: sales_rep_id is not filtered on yet. Reps still read their
-- whole org's repair_orders via the existing organization_id-scoped
-- policies — this migration only establishes the ownership key itself.
