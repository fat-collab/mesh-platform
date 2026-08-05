-- ============================================================================
-- MESH — Proof-of-Payment path convention + stricter write policy on the
-- 'documents' bucket (20260806000000).
--
-- Path: {organization_id}/repair-orders/{ro_id}/proof-of-payment/{uuid}.{ext}
--
-- DELIBERATE PLUMBING AHEAD OF THE FEATURE. Per the PoP investigation: there
-- is currently no real Proof-of-Payment capture pipeline anywhere in this
-- app — no upload UI, /api/v1/payments/verify has no caller, and no stage
-- gate actually checks proof_of_payments/ocr_verified_flag despite CLAUDE.md
-- describing it as an enforced rule. This migration does not build that
-- pipeline. It only reserves the path convention and access policy so that
-- when the capture UI is built, it has a correctly-scoped place to write to
-- from day one, instead of repeating the base64-inline-column mistake this
-- whole Storage migration exists to fix.
--
-- Why a carve-out instead of just adding a new policy: RLS policies for the
-- same command are OR'd together, not AND'd — a broader policy that already
-- permits SALES/TECH/ADJUSTER to read/write anywhere under the org folder
-- cannot be narrowed by simply adding a stricter policy alongside it, since
-- any one matching policy grants access. documents_select/documents_write
-- are both redefined here to exclude proof-of-payment paths;
-- documents_pop_select/documents_pop_write are the only policies that can
-- grant access to them, and both are MANAGER/EXECUTIVE only.
--
-- Read is gated as tightly as write, deliberately: a check image carries
-- routing and account numbers, and while a SALES/TECH/ADJUSTER user can
-- never upload one (documents_write excludes them), leaving
-- documents_select unrestricted would still let them view one. Read
-- exposure was judged the bigger risk here, not the smaller one.
--
-- Path discrimination: a proof-of-payment object has 4 folder segments
-- (org / repair-orders / ro_id / proof-of-payment) before its filename; an
-- RO invoice object (ops-db.ts) has only 3 (org / repair-orders / ro_id) —
-- (storage.foldername(name))[4] is null for the latter, so the `= '
-- proof-of-payment'` check excludes it cleanly without needing a separate
-- allowlist of non-PoP repair-order paths.
-- ============================================================================

drop policy if exists documents_select on storage.objects;

create policy documents_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_user_org_id()::text
    and coalesce((storage.foldername(name))[4], '') <> 'proof-of-payment'
  );

drop policy if exists documents_pop_select on storage.objects;

create policy documents_pop_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_user_org_id()::text
    and (storage.foldername(name))[4] = 'proof-of-payment'
    and public.current_user_is('MANAGER', 'EXECUTIVE')
  );

drop policy if exists documents_write on storage.objects;

create policy documents_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_user_org_id()::text
    and public.current_user_is('SALES', 'TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
    and coalesce((storage.foldername(name))[4], '') <> 'proof-of-payment'
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_user_org_id()::text
    and public.current_user_is('SALES', 'TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
    and coalesce((storage.foldername(name))[4], '') <> 'proof-of-payment'
  );

drop policy if exists documents_pop_write on storage.objects;

create policy documents_pop_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_user_org_id()::text
    and (storage.foldername(name))[4] = 'proof-of-payment'
    and public.current_user_is('MANAGER', 'EXECUTIVE')
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_user_org_id()::text
    and (storage.foldername(name))[4] = 'proof-of-payment'
    and public.current_user_is('MANAGER', 'EXECUTIVE')
  );
