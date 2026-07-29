-- ============================================================================
-- MESH — Vector 3: Fleet, external rentals & reimbursement gate
--
--  * customer_rentals: external rental / loaner tracking per RO (policy caps,
--    expiry, daily rate, lifecycle).
--  * rental_reimbursements: what the shop is owed for rentals (carrier or shop
--    fleet) — outstanding PENDING/PARTIAL rows gate RO closeout (with an
--    Executive/Manager override).
-- ============================================================================

create table if not exists public.customer_rentals (
  id                uuid primary key default gen_random_uuid(),
  repair_order_id   uuid references public.repair_orders(id) on delete cascade,
  rental_company    text not null,
  claimant_name     text,
  policy_max_days   int,
  rental_expiry_date date,
  daily_rate        numeric(10,2),
  status            text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'EXTENDED', 'EXPIRED', 'RETURNED')),
  created_at        timestamptz not null default now()
);

create table if not exists public.rental_reimbursements (
  id                uuid primary key default gen_random_uuid(),
  repair_order_id   uuid references public.repair_orders(id) on delete cascade,
  provider_type     text not null
    check (provider_type in ('EXTERNAL_INSURANCE', 'SHOP_FLEET')),
  claimed_amount    numeric(12,2) not null default 0,
  collected_amount  numeric(12,2) not null default 0,
  status            text not null default 'PENDING'
    check (status in ('PENDING', 'PARTIAL', 'COLLECTED', 'DISPUTED')),
  notes             text,
  created_at        timestamptz not null default now()
);

create index if not exists customer_rentals_ro_idx
  on public.customer_rentals (repair_order_id);
create index if not exists rental_reimbursements_ro_idx
  on public.rental_reimbursements (repair_order_id);
