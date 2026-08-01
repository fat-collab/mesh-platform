-- ============================================================================
-- MESH Sales — Quick Porch Capture
--
-- Additive columns on intake_leads for QuickLeadModal: a minimal, name-only-
-- required fast path for a rep standing at a customer's door. address and
-- damage_type aren't part of the base schema (intake_leads.sql) or either
-- prior additive migration (catastrophe_hub, legal_carrier_shield) — both
-- nullable, filled in later during the full intake if left blank here.
-- ============================================================================

alter table public.intake_leads
  add column if not exists address text,
  add column if not exists damage_type text;
