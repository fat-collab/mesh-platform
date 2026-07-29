-- ============================================================================
-- MESH — align insurance_payments RLS to the app's real roles.
--
-- Replaces the placeholder owner/general_manager policy with one keyed to the
-- actual role vocabulary (EXECUTIVE / MANAGER) via the JWT 'role' claim.
--
-- NOTE: the browser client uses a service-role key that BYPASSES RLS, and the
-- JWT 'role' claim is currently the Postgres role ('authenticated'/'anon') — a
-- custom claim carrying EXECUTIVE/MANAGER must be set for this to gate real
-- user sessions. Defense-in-depth until then.
-- ============================================================================

alter table public.insurance_payments enable row level security;

-- Retire the placeholder policy.
drop policy if exists insurance_payments_privileged on public.insurance_payments;

drop policy if exists "Only executives and managers can access insurance ledger"
  on public.insurance_payments;

create policy "Only executives and managers can access insurance ledger"
  on public.insurance_payments
  for all
  using (auth.jwt() ->> 'role' in ('EXECUTIVE', 'MANAGER'));
