-- ============================================================================
-- MESH — Data Privacy Shield
--
--  * audit_logs: append-only access/action trail (who did what to which target).
--  * RLS lockdown on insurance_payments: only privileged roles ('owner',
--    'general_manager') may read/write, keyed off the JWT 'role' claim.
--
-- NOTE: the app's browser client uses a service-role key, which BYPASSES RLS —
-- so this policy is defense-in-depth for user-JWT access paths. It also expects
-- a custom 'role' claim of 'owner'/'general_manager'; the app's own role model
-- is TECH/MANAGER/ADJUSTER/CUSTOMER/EXECUTIVE, so map claims accordingly before
-- relying on this in production.
-- ============================================================================

-- --- audit_logs -------------------------------------------------------------
create table if not exists public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  action     text,
  target_id  uuid,
  metadata   jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_user_id_idx on public.audit_logs (user_id);
create index if not exists audit_logs_target_id_idx on public.audit_logs (target_id);

-- --- insurance_payments RLS lockdown ----------------------------------------
alter table public.insurance_payments enable row level security;

drop policy if exists insurance_payments_privileged on public.insurance_payments;
create policy insurance_payments_privileged on public.insurance_payments
  for all
  to authenticated
  using ((auth.jwt() ->> 'role') in ('owner', 'general_manager'))
  with check ((auth.jwt() ->> 'role') in ('owner', 'general_manager'));
