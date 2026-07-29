-- ============================================================================
-- MESH — organization onboarding & legal click-wrap acceptance
--
-- Adds the onboarding-gateway fields (/dashboard/setup): shop contact details,
-- a setup-completed flag gating first-login routing, and the click-wrap
-- Terms-of-Service acceptance record (version + timestamp + accepting IP) for
-- the Legal Shield disclaimer.
-- ============================================================================

alter table public.organizations
  add column if not exists tos_accepted_at timestamptz;

alter table public.organizations
  add column if not exists tos_version text;

alter table public.organizations
  add column if not exists tos_accepted_ip text;

alter table public.organizations
  add column if not exists setup_completed boolean not null default false;

alter table public.organizations
  add column if not exists shop_email text;

alter table public.organizations
  add column if not exists shop_phone text;

alter table public.organizations
  add column if not exists tax_id text;
