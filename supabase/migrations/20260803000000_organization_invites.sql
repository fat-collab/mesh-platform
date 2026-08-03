-- ============================================================================
-- MESH — organization_invites: EXECUTIVE-issued invites to join an existing
-- organization with a specific role.
--
-- Problem this fixes: register/route.ts creates a brand-new organization on
-- every signup and hardcodes role EXECUTIVE. There is no path today for a
-- second person to land in an existing org — a shop owner and four reps
-- currently end up in five separate, empty organizations. This table is the
-- missing join mechanism.
--
-- Security property (the actual point of this table, not incidental):
-- role and organization_id are set ONLY here, at insert time, by the
-- inviting EXECUTIVE. The accept flow resolves both fields FROM THIS ROW by
-- token — it never accepts either as input from the person accepting the
-- invite. That is what makes self-assignment structurally impossible rather
-- than merely validated against: there is no code path in the accept route
-- that reads a role or an organization_id out of the request body at all.
--
-- File only. Not applied.
-- ============================================================================

create table if not exists public.organization_invites (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  email            text not null check (char_length(email) between 3 and 320),
  role             public.user_role not null,
  token            text not null unique,
  invited_by       uuid references public.users(id) on delete set null,
  status           text not null default 'PENDING'
                     check (status in ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
  expires_at       timestamptz not null default (now() + interval '7 days'),
  accepted_at      timestamptz,
  created_at       timestamptz not null default now()
);

-- Only one LIVE invite per org+email at a time. Re-inviting an address that
-- already has a PENDING invite is an application-level revoke-then-recreate,
-- not a second concurrent token — this index is what actually enforces that,
-- not just a pre-insert SELECT (which would race).
create unique index if not exists organization_invites_org_email_pending_unique
  on public.organization_invites (organization_id, email)
  where status = 'PENDING';

create index if not exists organization_invites_org_idx on public.organization_invites (organization_id);
create index if not exists organization_invites_token_idx on public.organization_invites (token);
create index if not exists organization_invites_email_idx on public.organization_invites (email);

alter table public.organization_invites enable row level security;

-- EXECUTIVE-only, scoped to their own org — same shape as organizations_update
-- (init_mesh.sql:484-487). No anon/public policy exists or is needed: the
-- accept-by-token flow (POST /api/v1/invites/[token]/accept) runs under the
-- service-role client, the same way convertLeadToRO's server-context caller
-- and the remote-AOB routes already do, because the person accepting an
-- invite has no organization_id yet for any RLS predicate here to match.
create policy organization_invites_select on public.organization_invites
  for select to authenticated
  using (
    organization_id = public.current_user_org_id()
    and public.current_user_is('EXECUTIVE')
  );

create policy organization_invites_write on public.organization_invites
  for all to authenticated
  using (
    organization_id = public.current_user_org_id()
    and public.current_user_is('EXECUTIVE')
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_is('EXECUTIVE')
  );

comment on table public.organization_invites is
  'EXECUTIVE-issued invites to join an existing organization with a specific role. role/organization_id are resolved from this row by token only -- the accept flow never accepts either as caller input.';
comment on column public.organization_invites.status is
  'PENDING (live, awaiting accept) | ACCEPTED (consumed) | REVOKED (cancelled by an EXECUTIVE) | EXPIRED (past expires_at -- lazily set by the accept/lookup routes, not a cron job).';
