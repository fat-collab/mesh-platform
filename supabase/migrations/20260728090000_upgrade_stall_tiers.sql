-- ============================================================================
-- MESH — upgrade Insurance No-Stall cadence to 4 tiers
--
-- stall_status: ACTIVE / PENDING_NUDGE / MANAGER_ESCALATED / SUPERVISOR_ESCALATED
-- (was ACTIVE / PENDING_NUDGE / ESCALATED). Legacy 'ESCALATED' rows are
-- normalized to 'MANAGER_ESCALATED' before the new constraint is applied.
-- ============================================================================

-- Drop the old check first so the normalization update is permitted.
alter table public.insurance_payments
  drop constraint if exists insurance_payments_stall_status_check;

update public.insurance_payments
  set stall_status = 'MANAGER_ESCALATED'
  where stall_status = 'ESCALATED';

alter table public.insurance_payments
  add constraint insurance_payments_stall_status_check
    check (stall_status in ('ACTIVE', 'PENDING_NUDGE', 'MANAGER_ESCALATED', 'SUPERVISOR_ESCALATED'));
