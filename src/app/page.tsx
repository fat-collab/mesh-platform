'use client';

/**
 * Root — redirects signed-in users to the Ops Cockpit, otherwise shows a
 * sign-in call to action. Session lives in the browser client (localStorage),
 * so this check runs client-side.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase';

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!cancelled && session) {
          router.replace('/dashboard/ops');
          return;
        }
      } catch {
        /* show the CTA */
      }
      if (!cancelled) setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-zinc-950 px-6 text-center text-zinc-100">
      <h1 className="text-3xl font-bold tracking-tight">MESH Platform</h1>
      <p className="mt-2 max-w-md text-sm text-zinc-400">
        PDR-first collision operations: reflection-grid dent vision, total-loss
        rebuttal math, hold-gate ops board, and a 1099 payout ledger.
      </p>

      {checking ? (
        <p className="mt-8 text-sm text-zinc-600">Checking session…</p>
      ) : (
        <Link
          href="/login"
          className="mt-8 rounded-md bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
        >
          Sign in
        </Link>
      )}
    </div>
  );
}
