/**
 * MESH — Team roster + invite reads/mutations for the Team settings page.
 *
 * Both tables' RLS already does the real access control (users_select is
 * any org member; organization_invites_select/write is EXECUTIVE-only,
 * scoped to their own org — see 20260803000000_organization_invites.sql).
 * organization_id is still passed and filtered on explicitly here rather
 * than leaning on RLS alone, matching this codebase's existing convention
 * (e.g. resolveOrganizationId's callers) of not treating RLS as the only
 * place tenant scoping is expressed.
 *
 * No local-fallback store here, unlike most *-db.ts files in this app: a
 * team roster / invite list with no persistence isn't useful to fall back
 * to, and silently showing a stale or empty local cache for a
 * membership/access-control screen is worse than a visible error.
 */
import { getSupabaseBrowserClient } from './supabase';

export const INVITE_ROLES = ['TECH', 'MANAGER', 'ADJUSTER', 'CUSTOMER', 'EXECUTIVE', 'SALES'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export interface TeamMember {
  id: string;
  fullName: string | null;
  email: string | null;
  role: string;
  createdAt: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
}

interface TeamMemberRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  created_at: string;
}

interface InviteRow {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
}

export async function getTeamMembers(organizationId: string): Promise<TeamMember[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data as unknown as TeamMemberRow[] | null) ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  }));
}

export async function getPendingInvites(organizationId: string): Promise<PendingInvite[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('organization_invites')
    .select('id, email, role, created_at, expires_at')
    .eq('organization_id', organizationId)
    .eq('status', 'PENDING')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data as unknown as InviteRow[] | null) ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}

/**
 * Sends an invite via POST /api/v1/organizations/invites (not a direct
 * table insert) — that route does the EXECUTIVE check with a real error
 * message, generates the token, and dispatches the email; duplicating any
 * of that here would drift from it.
 */
export async function sendInvite(
  email: string,
  role: InviteRole,
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'No active session.' };

  const res = await fetch('/api/v1/organizations/invites', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ email, role }),
  });
  const result = (await res.json()) as { success?: boolean; error?: string };
  if (!res.ok || !result.success) {
    return { success: false, error: result.error || 'Failed to send invite.' };
  }
  return { success: true };
}

/**
 * Revokes a PENDING invite directly (organization_invites_write RLS is
 * EXECUTIVE + own-org, so this is exactly as safe as routing it through an
 * API endpoint — there is no service-role step this operation needs, unlike
 * sendInvite's email dispatch). The .eq('status', 'PENDING') guard is belt-
 * and-suspenders: prevents a double-click from re-"revoking" an invite
 * that's since been accepted.
 */
export async function revokeInvite(inviteId: string, organizationId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from('organization_invites')
    .update({ status: 'REVOKED' })
    .eq('id', inviteId)
    .eq('organization_id', organizationId)
    .eq('status', 'PENDING');
  if (error) throw new Error(error.message);
}
