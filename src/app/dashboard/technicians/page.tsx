'use client';

/**
 * Technician Hub — a technician's active operation queue, live clock, and
 * daily efficiency.
 *
 * Role-gated to the floor + oversight roles (TECH / MANAGER / EXECUTIVE); other
 * roles and unauthenticated sessions are redirected to the Ops board. Guard runs
 * client-side against the resolved MESH profile, mirroring the other dashboards.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getCurrentProfile } from '@/lib/auth';
import { TechnicianDashboardView } from '@/components/technicians/TechnicianDashboardView';

type Gate = 'checking' | 'allowed' | 'denied';

const ALLOWED_ROLES = new Set(['TECH', 'MANAGER', 'EXECUTIVE']);

export default function TechniciansPage() {
  const router = useRouter();
  const [gate, setGate] = useState<Gate>('checking');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getCurrentProfile(getSupabaseBrowserClient());
        if (cancelled) return;
        if (profile?.role && ALLOWED_ROLES.has(profile.role)) {
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
          <h1 className="text-xl font-bold tracking-tight">Technician Hub</h1>
          <p className="text-sm text-zinc-400">
            Active operation queue, live clock &amp; daily efficiency
          </p>
        </header>

        {gate === 'checking' ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
            Verifying access…
          </div>
        ) : gate === 'denied' ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            Technician access required — redirecting…
          </div>
        ) : (
          <TechnicianDashboardView />
        )}
      </div>
    </div>
  );
}
