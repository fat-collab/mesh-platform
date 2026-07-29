create table if not exists insurance_payments (
  id uuid primary key default gen_random_uuid(),
  repair_order_id uuid not null references repair_orders(id) on delete cascade,
  amount numeric(12, 2) not null,
  check_number text,
  status text not null default 'PENDING', -- PENDING, CLEARED, VOID
  cleared_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_insurance_payments_repair_order_id on insurance_payments(repair_order_id);
