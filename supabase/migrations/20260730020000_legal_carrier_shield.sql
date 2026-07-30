-- ============================================================================
-- MESH Sales — Catastrophe Legal & Carrier Intelligence Shield
--
-- Additive columns on intake_leads for the Named Insured / Policyholder Match
-- split (and its captured proxy details), plus remote_aob_links — the
-- tokenized, unauthenticated-by-design signing flow for an off-site
-- policyholder. Carrier risk/checklist data (carrier-intel.ts) is static
-- in-code reference data, not persisted.
-- ============================================================================

alter table public.intake_leads
  add column if not exists policyholder_match boolean not null default true,
  add column if not exists proxy_policyholder jsonb,
  add column if not exists remote_aob_status text
    check (remote_aob_status is null or remote_aob_status in ('NOT_SENT', 'SENT', 'SIGNED')),
  add column if not exists remote_aob_token text;

-- ----------------------------------------------------------------------------
-- remote_aob_links — the Remote AOB Secure Signing Link record. lead_id is
-- plain text (not a FK): intake_leads.id is itself text (app-generated ids
-- like 'lead-<uuid>'), the same non-uuid-safe pattern already used elsewhere
-- in this schema (e.g. commission_overrides.ro_id).
--
-- RLS is intentionally permissive to anon: the whole point of this table is
-- that an off-site proxy policyholder — who has no MESH account — opens the
-- link and signs unauthenticated. The token itself (not a session) is the
-- security boundary, consistent with this app's stated demo RLS posture
-- (see intake_leads.sql). Tighten with a token-hash + expiry before
-- production use with real policyholder PII.
-- ----------------------------------------------------------------------------
create table if not exists public.remote_aob_links (
  token               text primary key,
  lead_id             text not null,
  organization_id     uuid references public.organizations(id) on delete cascade,
  proxy_full_name     text not null,
  proxy_relationship  text,
  proxy_phone         text,
  proxy_email         text,
  status              text not null default 'PENDING'
    check (status in ('PENDING', 'SIGNED', 'EXPIRED')),
  signature_url       text,
  created_at          timestamptz not null default now(),
  signed_at           timestamptz
);

create index if not exists remote_aob_links_lead_idx on public.remote_aob_links (lead_id);

alter table public.remote_aob_links enable row level security;

drop policy if exists remote_aob_links_all on public.remote_aob_links;
create policy remote_aob_links_all on public.remote_aob_links
  for all to authenticated, anon using (true) with check (true);
