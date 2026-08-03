'use client';

/**
 * /login — email/password sign-in via the Supabase browser client.
 * Includes quick-fill buttons for seeded demo accounts.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase';

const DEST = '/dashboard/ops';

interface DemoAccount {
  label: string;
  email: string;
  password: string;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  { label: 'Executive · Apex', email: 'executive@apex.com', password: 'password123' },
  { label: 'Manager · Bridgeway', email: 'manager@bridgeway.com', password: 'password123' },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
  }, [router]);

  async function signIn(withEmail: string, withPassword: string) {
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: withEmail,
        password: withPassword,
      });
      if (authError) {
        setError(authError.message);
        setBusy(false);
        return;
      }
      router.replace(DEST);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      setBusy(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void signIn(email, password);
  }

  function quickFill(account: DemoAccount) {
    setEmail(account.email);
    setPassword(account.password);
    void signIn(account.email, account.password);
  }

  if (checking) {
    return (
      <div className="flex min-h-full items-center justify-center bg-zinc-950 text-sm text-zinc-500">
        Checking session…
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-zinc-950 px-4 py-16 text-zinc-100">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">MESH</h1>
          <p className="mt-1 text-sm text-zinc-400">Sign in to the Ops Cockpit</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl"
        >
          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-medium text-zinc-400">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder="you@shop.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-medium text-zinc-400">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
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
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-5">
          <p className="mb-2 text-center text-xs uppercase tracking-wide text-zinc-600">
            Quick fill · seeded accounts
          </p>
          <div className="grid gap-2">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                disabled={busy}
                onClick={() => quickFill(account)}
                className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-left text-sm transition-colors hover:border-zinc-700 hover:bg-zinc-800/60 disabled:opacity-60"
              >
                <span className="font-medium text-zinc-200">{account.label}</span>
                <span className="font-mono text-xs text-zinc-500">{account.email}</span>
              </button>
            ))}
          </div>
        </div>

        <p className="mt-5 text-center text-sm text-zinc-500">
          New shop?{' '}
          <Link href="/register" className="font-medium text-sky-400 hover:text-sky-300">
            Create an account
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-zinc-600">
          Joining an existing shop? You&apos;ll need an invite link from your shop owner — check
          your email, or ask them to send one.
        </p>
      </div>
    </div>
  );
}
