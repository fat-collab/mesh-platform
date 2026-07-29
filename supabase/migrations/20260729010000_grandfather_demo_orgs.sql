-- ============================================================================
-- MESH — grandfather the seeded demo organizations past the onboarding gate.
--
-- The onboarding-columns migration (20260729000000) added setup_completed
-- with `not null default false`, which backfilled EVERY existing org —
-- including the two fixed-id seed orgs from scripts/seed-cloud.mjs (Apex
-- Collision, Bridgeway Auto Body) that the login page's demo "quick fill"
-- accounts belong to. Without this, those demo logins get forced into
-- /dashboard/setup on next sign-in.
--
-- Scoped to these two known seed org ids ONLY — not a blanket
-- `setup_completed = false -> true`, which would also grandfather real
-- self-service signups (via /register) that are genuinely mid-onboarding.
--
-- Deliberately does NOT set tos_accepted_at / tos_version: these orgs never
-- actually clicked through the Legal Shield, so backdating an acceptance
-- record would fabricate consent history. This migration only unblocks the
-- routing gate for demo convenience.
-- ============================================================================

update public.organizations
set setup_completed = true
where id in (
  '00000000-0000-0000-0000-00000000a001', -- Apex Collision
  '00000000-0000-0000-0000-00000000b001'  -- Bridgeway Auto Body
);
