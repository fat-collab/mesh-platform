/**
 * MESH Platform — client-side auth/profile helpers for the browser session.
 */
import type { UserRole } from './database.types';
import type { MeshSupabaseClient } from './supabase';

export interface CurrentProfile {
  authUserId: string;
  email: string | null;
  fullName: string | null;
  role: UserRole | null;
  organizationId: string | null;
  organizationName: string | null;
}

interface ProfileRow {
  full_name: string | null;
  role: UserRole;
  organization_id: string;
  organizations: { name: string | null } | null;
}

/**
 * Resolves the signed-in user's MESH profile (role + tenant), or null when
 * there is no active session.
 */
export async function getCurrentProfile(
  supabase: MeshSupabaseClient,
): Promise<CurrentProfile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('users')
    .select('full_name, role, organization_id, organizations ( name )')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  const row = data as unknown as ProfileRow | null;

  return {
    authUserId: user.id,
    email: user.email ?? null,
    fullName: row?.full_name ?? null,
    role: row?.role ?? null,
    organizationId: row?.organization_id ?? null,
    organizationName: row?.organizations?.name ?? null,
  };
}
