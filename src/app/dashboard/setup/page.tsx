'use client';

/**
 * /dashboard/setup — the onboarding gateway. Collects shop contact details and
 * requires click-wrap acceptance of the MESH Legal Shield before the org can be
 * used. Landed on directly after registration; redirects to the Ops board once
 * setup_completed is true (including on repeat visits).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getCurrentProfile } from '@/lib/auth';

const DEST = '/dashboard/ops';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TOS_TEXT = `SaaS Provision Only: MESH is a software-as-a-service operational tool provided 'as is' and 'as available.' MESH, its developers, and its principals disclaim all liability for financial calculations, repair order estimates, subcontractor tracking, rental reimbursements, or data loss arising from shop operations. Tenant Data Autonomy: The subscribing Organization ('Shop') maintains sole legal and regulatory responsibility for compliance, tax filings, consumer privacy, and data governance within their jurisdiction. Indemnification Shield: The Shop agrees to indemnify, defend, and hold harmless MESH and its principals from any third-party claims, subcontractor disputes, regulatory penalties, or operational losses resulting from the use of the platform.`;

type Gate = 'checking' | 'ready';

interface SetupResponse {
  success?: boolean;
  error?: string;
}

export default function DashboardSetupPage() {
  const router = useRouter();
  const [gate, setGate] = useState<Gate>('checking');

  const [shopPhone, setShopPhone] = useState('');
  const [shopEmail, setShopEmail] = useState('');
  const [taxId, setTaxId] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve the session; skip straight past setup if it's already complete.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = getSupabaseBrowserClient();
      const profile = await getCurrentProfile(supabase);
      if (cancelled) return;

      if (!profile) {
        router.replace('/login');
        return;
      }

      if (profile.organizationId) {
        const { data } = await supabase
          .from('organizations')
          .select('setup_completed')
          .eq('id', profile.organizationId)
          .maybeSingle();
        if (cancelled) return;
        if ((data as { setup_completed: boolean } | null)?.setup_completed) {
          router.replace(DEST);
          return;
        }
      }

      setGate('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!shopPhone.trim() || !shopEmail.trim() || !taxId.trim()) {
      setError('All fields are required.');
      return;
    }
    if (!EMAIL_RE.test(shopEmail.trim())) {
      setError('Enter a valid shop email address.');
      return;
    }
    if (!agreed) {
      setError('You must accept the Terms of Service to continue.');
      return;
    }

    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }

      const res = await fetch('/api/v1/organizations/setup', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ shopPhone, shopEmail, taxId }),
      });
      const result = (await res.json()) as SetupResponse;
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Setup failed.');
      }

      router.replace(DEST);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed.');
      setBusy(false);
    }
  }

  if (gate === 'checking') {
    return (
      <div className="flex min-h-full items-center justify-center bg-zinc-950 text-sm text-zinc-500">
        Loading your shop…
      </div>
    );
  }

  const input =
    'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500';
  const labelCls = 'mb-1 block text-xs font-medium text-zinc-400';

  return (
    <div className="flex min-h-full items-center justify-center bg-zinc-950 px-4 py-16 text-zinc-100">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Finish setting up your shop</h1>
          <p className="mt-1 text-sm text-zinc-400">
            A few details before you jump into the Ops Cockpit.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="shopPhone" className={labelCls}>
                Shop phone
              </label>
              <input
                id="shopPhone"
                type="tel"
                autoComplete="tel"
                required
                value={shopPhone}
                onChange={(e) => setShopPhone(e.target.value)}
                className={input}
                placeholder="(512) 555-0142"
              />
            </div>

            <div>
              <label htmlFor="shopEmail" className={labelCls}>
                Shop email
              </label>
              <input
                id="shopEmail"
                type="email"
                autoComplete="email"
                required
                value={shopEmail}
                onChange={(e) => setShopEmail(e.target.value)}
                className={input}
                placeholder="frontdesk@shop.com"
              />
            </div>
          </div>

          <div>
            <label htmlFor="taxId" className={labelCls}>
              Tax ID / registration number
            </label>
            <input
              id="taxId"
              type="text"
              required
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              className={input}
              placeholder="XX-XXXXXXX"
            />
          </div>

          {/* MESH Legal Shield — click-wrap acceptance */}
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
            {busy ? 'Finishing setup…' : 'Complete setup & enter Ops Cockpit'}
          </button>
        </form>
      </div>
    </div>
  );
}
