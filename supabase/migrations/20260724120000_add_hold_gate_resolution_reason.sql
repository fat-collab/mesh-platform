-- ============================================================================
-- MESH Platform — add resolution_reason to hold_gate_logs
--
-- The Hold Gate Resolution flow records WHY an operator released a gate
-- (e.g. "Carrier Confirmed", "Parts Arrived", "Customer Approved", or a custom
-- note) alongside the existing unlock timestamp. Idempotent so it is safe to
-- re-run against an already-provisioned database.
-- ============================================================================

alter table public.hold_gate_logs
  add column if not exists resolution_reason text;
