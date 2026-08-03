'use client';

/**
 * /invite/[token] — accept an org invite.
 *
 * Public, unauthenticated by design: the invitee has no MESH session yet.
 * Two server calls, both strictly token-keyed (never send an org id or role
 * from this page — there is nowhere on this page that even holds one):
 *  - GET  /api/v1/invites/[token] — who's inviting, to what org, what role.
 *  - POST /api/v1/invites/[token]/accept — creates/attaches the account.
 *    organization_id and role are resolved server-side from the invite row;
 *    this page only ever sends { fullName, password }.
 *
 * After a successful accept, this page signs in client-side with the same
 * credentials to establish the browser session — same two-step pattern
 * /register uses (provisioning is server-side/admin API, the session is
 * established separately), since neither accept branch (new account vs.
 * existing account verified server-side) hands back a browser-usable
 * session in the JSON response.
 */
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase';

interface InviteSummary {
  valid: boolean;
  organizationName: string | null;
  role: string;
  email: string;
  reason?: 'EXPIRED' | 'ACCEPTED' | 'REVOKED';
}

interface AcceptResponse {
  success?: boolean;
  error?: string;
}

const DEST = '/dashboard/ops';

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;

  const [summary, setSummary] = useState<InviteSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/invites/${encodeURIComponent(token)}`);
        if (!cancelled) {
          if (res.ok) {
            setSummary((await res.json()) as InviteSummary);
          } else {
            setSummary(null);
          }
        }
      } catch {
        if (!cancelled) setSummary(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/v1/invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, password }),
      });
      const result = (await res.json()) as AcceptResponse;
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Failed to accept invite.');
      }

      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: summary?.email ?? '',
        password,
      });
      if (signInError) throw new Error(signInError.message);

      router.replace(DEST);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invite.');
      setBusy(false);
    }
  }

  const input =
    'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500';
  const labelCls = 'mb-1 block text-xs font-medium text-zinc-400';

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-500">
        Loading invite…
      </div>
    );
  }

  if (!summary || !summary.valid) {
    const reasonText: Record<string, string> = {
      EXPIRED: 'This invite has expired. Ask your shop owner to send a new one.',
      ACCEPTED: 'This invite has already been used. Sign in instead.',
      REVOKED: 'This invite has been revoked.',
    };
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-center">
        <div>
          <h1 className="text-lg font-bold text-zinc-100">Invite not available</h1>
          <p className="mt-2 text-sm text-zinc-500">
            {summary?.reason ? reasonText[summary.reason] : 'This invite link is invalid.'}
          </p>
          <Link href="/login" className="mt-4 inline-block text-sm font-medium text-sky-400 hover:text-sky-300">
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-16 text-zinc-100">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">MESH</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Join <strong className="text-zinc-200">{summary.organizationName ?? 'your team'}</strong> as{' '}
            <strong className="text-zinc-200">{summary.role}</strong>
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl"
        >
          <div>
            <label className={labelCls}>Email</label>
            <input value={summary.email} disabled className={`${input} opacity-60`} />
          </div>

          <div>
            <label htmlFor="fullName" className={labelCls}>
              Your full name
            </label>
            <input
              id="fullName"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={input}
              placeholder="Jordan Rivera"
            />
          </div>

          <div>
            <label htmlFor="password" className={labelCls}>
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input}
              placeholder="••••••••"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Already have a MESH account at this email? Enter its existing password to link it to{' '}
              {summary.organizationName ?? 'this shop'} instead of creating a new one.
            </p>
          </div>

          <div>
            <label htmlFor="confirmPassword" className={labelCls}>
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={input}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-60"
          >
            {busy ? 'Joining…' : 'Accept invite'}
          </button>
        </form>
      </div>
    </div>
  );
}
