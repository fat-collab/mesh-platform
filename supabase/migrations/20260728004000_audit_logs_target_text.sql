-- ============================================================================
-- MESH — audit_logs.target_id: uuid -> text
--
-- target_id was uuid, but audited targets aren't always uuids (e.g. sample
-- board RO ids like 'mock-a6f1', claim numbers). Widen to text so any target
-- identifier can be logged. The target_id index is rebuilt automatically.
-- ============================================================================

alter table public.audit_logs
  alter column target_id type text using target_id::text;
