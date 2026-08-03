'use client';

/**
 * Shown by dashboard/layout.tsx when a session exists but no `public.users`
 * row does — reachable now that invites exist (e.g. the accept flow created
 * the auth account, then died before the profile insert committed; or the
 * user closed the tab mid-accept). Previously this state silently bounced to
 * /login with no explanation, which is a dead end: /login itself redirects a
 * signed-in session straight back to /dashboard, landing right back here.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase';

export function NoOrganizationScreen({ email }: { email: string | null }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      /* ignore — navigate away regardless */
    }
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 text-center shadow-xl">
        <h1 className="text-lg font-bold text-zinc-100">Your account isn&apos;t attached to a shop</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {email ? <>{email} is</> : 'This account is'} signed in, but isn&apos;t linked to a MESH
          organization yet. This usually means an invite was only partly accepted.
        </p>
        <p className="mt-3 text-sm text-zinc-400">
          If you have an invite email, open its link again to finish joining — it&apos;s safe to
          use more than once. If you don&apos;t have one, ask your shop&apos;s owner to send you an
          invite.
        </p>
        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={signingOut}
          className="mt-5 w-full rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-60"
        >
          {signingOut ? 'Signing out…' : 'Log out'}
        </button>
      </div>
    </div>
  );
}
