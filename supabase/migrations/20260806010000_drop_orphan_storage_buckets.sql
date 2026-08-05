-- ============================================================================
-- MESH — drop three orphaned Storage buckets: intake-documents, signatures,
-- supplement-photos.
--
-- Found during the documents-bucket investigation (20260806000000): these
-- three buckets exist live but appear in NO migration and NO commit in this
-- repo's history (`git log -S` across all branches — zero hits on either
-- name). All three were created directly against the project on
-- 2026-07-25 within about an hour of each other (03:17:13, 03:17:35,
-- 04:17:20) — the day after project creation and before any Storage-writing
-- application code existed. Whole-repo grep found exactly one
-- `.storage.from(...)` call anywhere in src/, and it points at a different,
-- also-nonexistent bucket ('secure-customer-docs', see the companion fix in
-- 20260806000000_documents_storage_bucket.sql) — nothing in this codebase
-- has ever referenced these three by name.
--
-- Confirmed via direct query against storage.objects: 0 rows in any of the
-- three, at any time — not just uncalled by app code, genuinely never
-- written to, by the app or by hand by the dashboard.
--
-- All three were `public = true` with no `file_size_limit` and no
-- `allowed_mime_types` — an unrestricted, publicly-readable bucket that no
-- code is aware of is a pure liability with zero offsetting value. Dropping
-- rather than repurposing: the intake/signature/supplement document paths
-- these names suggest are exactly what the new private 'documents' bucket
-- (20260806000000) now covers, with real RLS and size/MIME limits.
-- ============================================================================

delete from storage.objects where bucket_id in ('intake-documents', 'signatures', 'supplement-photos');
delete from storage.buckets where id in ('intake-documents', 'signatures', 'supplement-photos');
