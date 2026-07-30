'use client';

/**
 * /register — self-service shop sign-up. Provisions a new organization
 * (POST /api/v1/auth/register) with the signing-up user as its EXECUTIVE
 * owner, then signs in client-side to establish the session.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase';

const DEST = '/dashboard/setup';

const TOS_TEXT = `SaaS Provision Only: MESH is a software-as-a-service operational tool provided 'as is' and 'as available.' MESH, its developers, and its principals disclaim all liability for financial calculations, repair order estimates, subcontractor tracking, rental reimbursements, or data loss arising from shop operations. Tenant Data Autonomy: The subscribing Organization ('Shop') maintains sole legal and regulatory responsibility for compliance, tax filings, consumer privacy, and data governance within their jurisdiction. Indemnification Shield: The Shop agrees to indemnify, defend, and hold harmless MESH and its principals from any third-party claims, subcontractor disputes, regulatory penalties, or operational losses resulting from the use of the platform.`;

interface RegisterResponse {
  success?: boolean;
  error?: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  // If already signed in, skip straight to the dashboard.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!cancelled && session) {
          router.replace(DEST);
          return;
        }
      } catch {
        /* fall through to the form */
      }
      if (!cancelled) setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!agreed) {
      setError('You must accept the Terms of Service to continue.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fullName, organizationName, tosAccepted: agreed }),
      });
      const result = (await res.json()) as RegisterResponse;
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Registration failed.');
      }

      // Provisioning is server-side (admin API); establish the session here.
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw new Error(signInError.message);

      router.replace(DEST);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-full items-center justify-center bg-zinc-950 text-sm text-zinc-500">
        Checking session…
      </div>
    );
  }

  const input =
    'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500';
  const labelCls = 'mb-1 block text-xs font-medium text-zinc-400';

  return (
    <div className="flex min-h-full items-center justify-center bg-zinc-950 px-4 py-16 text-zinc-100">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">MESH</h1>
          <p className="mt-1 text-sm text-zinc-400">Set up your shop&apos;s Ops Cockpit</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl"
        >
          <div>
            <label htmlFor="organizationName" className={labelCls}>
              Shop / organization name
            </label>
            <input
              id="organizationName"
              type="text"
              autoComplete="organization"
              required
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              className={input}
              placeholder="Apex Collision Center"
            />
          </div>

          <div>
            <label htmlFor="fullName" className={labelCls}>
              Your full name
            </label>
            <input
              id="fullName"
              type="text"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={input}
              placeholder="Jordan Rivera"
            />
          </div>

          <div>
            <label htmlFor="email" className={labelCls}>
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={input}
              placeholder="you@shop.com"
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

          {/* MESH Legal Shield — click-wrap acceptance (upstream of setup) */}
          <div>
            <p className={labelCls}>MESH Legal Shield</p>
            <blockquote className="max-h-40 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-400">
              {TOS_TEXT}
            </blockquote>
            <label className="mt-2 flex items-start gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                required
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5"
              />
              I have read and agree to the MESH Terms of Service and Legal Shield above.
            </label>
          </div>

          {error && (
            <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !agreed}
            className="w-full rounded-md bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-60"
          >
            {busy ? 'Creating your shop…' : 'Create shop account'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-zinc-500">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-sky-400 hover:text-sky-300">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
