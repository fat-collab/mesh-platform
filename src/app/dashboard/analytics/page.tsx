'use client';

/**
 * Executive Analytics — profit performance & margin-leakage dashboard.
 *
 * Role-gated: only EXECUTIVE profiles may view it. Non-executives (and
 * unauthenticated sessions) are redirected to the Ops board. The guard runs
 * client-side against the resolved MESH profile, mirroring the Navbar gating.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getCurrentProfile } from '@/lib/auth';
import { ExecutiveDashboardView } from '@/components/analytics/ExecutiveDashboardView';

type Gate = 'checking' | 'allowed' | 'denied';

export default function AnalyticsPage() {
  const router = useRouter();
  const [gate, setGate] = useState<Gate>('checking');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getCurrentProfile(getSupabaseBrowserClient());
        if (cancelled) return;
        if (profile?.role === 'EXECUTIVE') {
          setGate('allowed');
        } else {
          setGate('denied');
          router.replace('/dashboard/ops');
        }
      } catch {
        if (!cancelled) {
          setGate('denied');
          router.replace('/dashboard/ops');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <header className="mb-5">
          <h1 className="text-xl font-bold tracking-tight">Executive Analytics</h1>
          <p className="text-sm text-zinc-400">
            Shop profit performance &amp; margin-leakage tracking
          </p>
        </header>

        {gate === 'checking' ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
            Verifying access…
          </div>
        ) : gate === 'denied' ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            Executive access required — redirecting…
          </div>
        ) : (
          <ExecutiveDashboardView />
        )}
      </div>
    </div>
  );
}
