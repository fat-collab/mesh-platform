-- ============================================================================
-- MESH — 1099 subcontractor milestone payouts (Vector 2)
--
-- Milestone-based payouts to 1099 subcontractors, gated on the parent repair
-- order clearing the master financial gate (repair_orders.financial_status =
-- 'closed_paid') before a milestone can be RELEASED.
--
-- (Filename uses version 006000 — 004000 was already taken by
-- audit_logs_target_text; reusing it would collide in migration history.)
-- ============================================================================

create table if not exists public.subcontractor_milestones (
  id                    uuid primary key default gen_random_uuid(),
  repair_order_id       uuid references public.repair_orders(id) on delete cascade,
  contractor_name       text not null,
  milestone_description text not null,
  amount                numeric(12,2) not null default 0,
  status                text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'RELEASED', 'CANCELLED')),
  released_at           timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists subcontractor_milestones_ro_idx
  on public.subcontractor_milestones (repair_order_id);
