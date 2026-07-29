-- ============================================================================
-- MESH — Ops Timeline / AI Dispatch + Insurance "No-Stall" cadence
--
--  * ops_timelines: unified per-RO event stream (events + AI dispatch payloads).
--  * insurance_payments cadence columns: track carrier follow-up cadence so the
--    No-Stall protocol can auto-flag stalls (Day 3 nudge, Day 5 escalate,
--    Day 7+ supervisor).
-- ============================================================================

create table if not exists public.ops_timelines (
  id               uuid primary key default gen_random_uuid(),
  repair_order_id  uuid references public.repair_orders(id) on delete cascade,
  event_type       text not null,
  description      text not null,
  metadata         jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists ops_timelines_ro_idx
  on public.ops_timelines (repair_order_id);

-- --- insurance No-Stall cadence tracking ------------------------------------
alter table public.insurance_payments
  add column if not exists submitted_at timestamptz default now();

alter table public.insurance_payments
  add column if not exists last_nudge_at timestamptz;

alter table public.insurance_payments
  add column if not exists nudge_count int not null default 0;

alter table public.insurance_payments
  add column if not exists stall_status text not null default 'ACTIVE'
    check (stall_status in ('ACTIVE', 'PENDING_NUDGE', 'ESCALATED'));

create index if not exists insurance_payments_stall_status_idx
  on public.insurance_payments (stall_status);
