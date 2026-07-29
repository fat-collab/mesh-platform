'use client';

/**
 * Inventory & Purchase Orders — shop parts catalog, vendor price comparison,
 * and PO generation.
 *
 * Role-gated to management (MANAGER / EXECUTIVE). Other roles and
 * unauthenticated sessions are redirected to the Ops board. The guard runs
 * client-side against the resolved MESH profile, mirroring the Navbar gating.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getCurrentProfile } from '@/lib/auth';
import { ProcurementDashboardView } from '@/components/inventory/ProcurementDashboardView';

type Gate = 'checking' | 'allowed' | 'denied';

export default function InventoryPage() {
  const router = useRouter();
  const [gate, setGate] = useState<Gate>('checking');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getCurrentProfile(getSupabaseBrowserClient());
        if (cancelled) return;
        if (profile?.role === 'MANAGER' || profile?.role === 'EXECUTIVE') {
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
          <h1 className="text-xl font-bold tracking-tight">Parts Procurement</h1>
          <p className="text-sm text-zinc-400">
            RO parts request queue, purchase orders &amp; vendor catalog
          </p>
        </header>

        {gate === 'checking' ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
            Verifying access…
          </div>
        ) : gate === 'denied' ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            Management access required — redirecting…
          </div>
        ) : (
          <ProcurementDashboardView />
        )}
      </div>
    </div>
  );
}
