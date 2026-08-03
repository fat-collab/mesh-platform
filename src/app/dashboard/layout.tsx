import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { Navbar } from '@/components/layout/Navbar';
import { NoOrganizationScreen } from '@/components/layout/NoOrganizationScreen';
import { getSupabaseServerComponentClient } from '@/lib/supabase-server';

/** Shape of the users -> organizations embed used for the setup gate. */
interface SetupGateRow {
  organization_id: string | null;
  organizations: { setup_completed: boolean | null } | null;
}

/**
 * Strict server-side guard: no session -> /login, no organization -> an
 * explanation screen (not a redirect — see NoOrganizationScreen's own
 * comment for why a bare /login redirect is a dead end here now that
 * invites exist), setup incomplete (and not already on /dashboard/setup) ->
 * /dashboard/setup. Runs before any HTML is sent, so there is no
 * client-side redirect flash for the redirect cases.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await getSupabaseServerComponentClient();

  // getUser() (not getSession()) revalidates the JWT against the Auth server —
  // required for a trustworthy server-side check.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data } = await supabase
    .from('users')
    .select('organization_id, organizations ( setup_completed )')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  const profile = data as unknown as SetupGateRow | null;

  if (!profile?.organization_id) {
    return <NoOrganizationScreen email={user.email ?? null} />;
  }

  const setupCompleted = profile.organizations?.setup_completed;
  const pathname = (await headers()).get('x-pathname') ?? '';
  const onSetupPage = pathname === '/dashboard/setup';

  if (setupCompleted === false && !onSetupPage) {
    redirect('/dashboard/setup');
  }

  return (
    <div className="flex min-h-full flex-col bg-zinc-950 text-zinc-100">
      <Navbar />
      <main className="flex-1">{children}</main>
    </div>
  );
}
