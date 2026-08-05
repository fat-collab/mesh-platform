-- ============================================================================
-- MESH — 'documents' Storage bucket + RLS.
--
-- Context: intake_leads.documents / .damage_photos / .signature_url /
-- .rental_agreement_signature_url and remote_aob_links.signature_url were
-- being written as base64 data URLs (readAsDataURL / canvas.toDataURL)
-- directly into jsonb/text columns. Confirmed live: intake_leads row
-- 'lead-89fda7ed-f801-4ed1-a585-9df6ad89a810' (Pamela Anderson) reached
-- 22.6 MB, 'lead-0192184e-c960-4208-8d9a-7b6f38229f74' (Michael Jordan)
-- 6.4 MB — pg_stat_statements showed every query shape against intake_leads
-- (including plain PK lookups) running 1.4-3.7s mean / up to 7.5s max
-- because of TOAST detoast cost on those rows, which is what caused the
-- intermittent 'canceling statement due to statement timeout' failures on
-- /dashboard/sales.
--
-- A second, unrelated bug found during the same investigation: several
-- upload paths (LeadDetailDrawer, MobileIntakeWizard's document vault and
-- walkaround photos, the fleet loaner driver-doc capture, the RO invoice
-- upload) wrote `URL.createObjectURL(file)` blob: URLs into DB columns —
-- those never left the browser tab that created them and are permanently
-- unresolvable now; the files behind them are not recoverable from
-- anything this migration touches.
--
-- This migration ONLY creates the bucket and its RLS policies. It does not
-- change application code (still writing base64/blob URLs after this
-- runs) and does not touch the two bloated rows' data — see the separate,
-- not-yet-applied plan for migrating their real document content into this
-- bucket before anything destructive happens to them.
--
-- Path convention — every object's first path segment is the owning org,
-- so one predicate on storage.objects.name covers every domain below:
--
--   {organization_id}/leads/{lead_id}/documents/{kind}-{uuid}.{ext}
--     DL_FRONT, DL_BACK, INSURANCE_CARD, PRIOR_ESTIMATE, carrier-checklist
--     docs, MobileIntakeWizard vault docs, walkaround photos.
--   {organization_id}/leads/{lead_id}/damage-photos/{uuid}.{ext}
--     intake_leads.damage_photos — kept in its own segment, not lumped
--     into documents/, because hail jobs produce many photos per vehicle;
--     this is the highest-volume path and benefits from being separately
--     browsable/rate-limited later without touching the low-volume,
--     high-sensitivity identity documents next to it.
--   {organization_id}/leads/{lead_id}/signature-{uuid}.png
--     intake_leads.signature_url
--   {organization_id}/leads/{lead_id}/rental-signature-{uuid}.png
--     intake_leads.rental_agreement_signature_url
--   {organization_id}/remote-aob/{link_id}/signature-{uuid}.png
--     remote_aob_links.signature_url — written by the service-role client
--     from the token-gated sign route (no authenticated session exists for
--     an anonymous signer), so it bypasses the RLS below by design; the
--     SELECT policy still applies once staff view it back through the app.
--   {organization_id}/repair-orders/{ro_id}/invoice-{uuid}.{ext}
--     ops-db.ts invoice_url
--   {organization_id}/fleet/{loan_driver_id}/license-{uuid}.{ext}
--   {organization_id}/fleet/{loan_driver_id}/insurance-{uuid}.{ext}
--     rental-db.ts license_document_url / insurance_document_url
--
-- Note: intake_leads.documents / .damage_photos currently hold IntakeDocumentRef
-- objects with a `url` field. That field is being renamed to `storagePath`
-- in the same pass as the upload-path rewrite (not this migration) — a
-- field that holds a path but is named `url` is exactly the class of bug
-- that produced the blob: URL findings above.
--
-- Private bucket + short-TTL signed URLs, not a public bucket: these are
-- driver's licenses, insurance cards, and signatures. A public bucket
-- means permanent, unauthenticated, unrevocable access to anyone who ever
-- sees the URL.
--
-- NOTE: an earlier version of this comment described this bucket as
-- "distinct from the pre-existing 'secure-customer-docs' bucket." That was
-- wrong — 'secure-customer-docs' does not exist in this project.
-- src/app/api/v1/secure-docs/route.ts references it (intended for
-- Proof-of-Payment check images, EXECUTIVE/MANAGER only) but the bucket was
-- never created, so that route has always failed. See the separate report
-- on that route's actual callers and current PoP-capture behavior before
-- deciding whether to create 'secure-customer-docs' or fold PoP documents
-- into this 'documents' bucket instead (own path segment, its own role
-- policy — PoP documents are financial evidence, not intake/fleet
-- documents, so EXECUTIVE/MANAGER-only access should stay separate from
-- the SALES/TECH/ADJUSTER/MANAGER/EXECUTIVE write policy below either way).
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  15728640, -- 15 MB per object — hard backstop independent of any client-side check
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

-- storage.objects ships with RLS already enabled by Supabase; only policies
-- are added here.

drop policy if exists documents_select on storage.objects;
drop policy if exists documents_write on storage.objects;

-- Any authenticated org member can read/download — matches intake_leads_select
-- (no role branching on read), consistent with how the rest of this schema
-- scopes SELECT vs WRITE.
create policy documents_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_user_org_id()::text
  );

-- Same org check + same role set as intake_leads_write / lead_vehicles_write,
-- for the same reason: these are the roles that capture intake documents.
create policy documents_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_user_org_id()::text
    and public.current_user_is('SALES', 'TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_user_org_id()::text
    and public.current_user_is('SALES', 'TECH', 'ADJUSTER', 'MANAGER', 'EXECUTIVE')
  );
