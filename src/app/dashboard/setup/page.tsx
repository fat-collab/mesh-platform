'use client';

/**
 * /dashboard/setup — the onboarding gateway. Collects/confirms shop contact
 * details, auto-filled from the organization's existing record. Landed on
 * directly after registration; redirects to the Ops board once
 * setup_completed is true (including on repeat visits).
 *
 * The legal click-wrap (Terms of Service acceptance) has moved upstream to
 * registration — this page no longer gates on it.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getCurrentProfile } from '@/lib/auth';

const DEST = '/dashboard/ops';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Gate = 'checking' | 'ready';

interface OrganizationRow {
  name: string | null;
  setup_completed: boolean;
  shop_phone: string | null;
  shop_email: string | null;
  tax_id: string | null;
}

interface SetupResponse {
  success?: boolean;
  error?: string;
}

export default function DashboardSetupPage() {
  const router = useRouter();
  const [gate, setGate] = useState<Gate>('checking');

  const [shopName, setShopName] = useState('');
  const [shopPhone, setShopPhone] = useState('');
  const [shopEmail, setShopEmail] = useState('');
  const [taxId, setTaxId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve the session, auto-fill from the org's existing record, and skip
  // straight past setup if it's already complete.
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
          .select('name, setup_completed, shop_phone, shop_email, tax_id')
          .eq('id', profile.organizationId)
          .maybeSingle();
        if (cancelled) return;

        const org = data as OrganizationRow | null;
        if (org?.setup_completed) {
          router.replace(DEST);
          return;
        }
        if (org) {
          setShopName(org.name ?? '');
          setShopPhone(org.shop_phone ?? '');
          setShopEmail(org.shop_email ?? '');
          setTaxId(org.tax_id ?? '');
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

    if (!shopName.trim() || !shopPhone.trim() || !shopEmail.trim() || !taxId.trim()) {
      setError('All fields are required.');
      return;
    }
    if (!EMAIL_RE.test(shopEmail.trim())) {
      setError('Enter a valid shop email address.');
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
        body: JSON.stringify({ shopName, shopPhone, shopEmail, taxId }),
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
            Confirm your shop details before you jump into the Ops Cockpit.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl"
        >
          <div>
            <label htmlFor="shopName" className={labelCls}>
              Shop name
            </label>
            <input
              id="shopName"
              type="text"
              autoComplete="organization"
              required
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              className={input}
              placeholder="Apex Collision Center"
            />
          </div>

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
            {busy ? 'Finishing setup…' : 'Complete setup & enter Ops Cockpit'}
          </button>
        </form>
      </div>
    </div>
  );
}
