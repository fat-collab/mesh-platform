'use client';

/**
 * Payout cockpit — /dashboard/payouts
 *
 * Displays proof-of-payment receipts and the 50/10/40 Stripe Connect split
 * ledger grouped by repair order, with batch payout execution. Falls back to
 * sample data when no Supabase session returns rows.
 *
 * NOTE: "Execute" here advances the ledger row status (PENDING → PAID) and
 * persists it. Live Stripe Connect transfers are performed server-side by
 * `executePayoutSplits` via POST /api/v1/payments/verify; this cockpit records
 * and reflects that ledger state.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import type { PayoutSplitRole, PayoutStatus } from '@/lib/database.types';
import { SplitLedgerTable, type LedgerSplit } from '@/components/payouts/SplitLedgerTable';

interface PopReceipt {
  id: string;
  claim: string;
  amount: number | null;
  verified: boolean;
  imageUrl: string | null;
  createdAt: string;
}

interface RoLedger {
  roId: string;
  claim: string;
  splits: LedgerSplit[];
}

type Source = 'supabase' | 'sample';

/* ---- Raw row shapes (hand-typed to avoid generic churn) ------------------ */
interface RawSplit {
  id: string;
  ro_id: string;
  split_role: PayoutSplitRole | null;
  tech_split_pct: number;
  gross_amount: number;
  net_payout: number | null;
  status: PayoutStatus;
  stripe_transfer_id: string | null;
  repair_orders: { claim_number: string | null } | null;
}

interface RawPop {
  id: string;
  ro_id: string;
  check_amount: number | null;
  ocr_verified_flag: boolean;
  check_image_url: string | null;
  created_at: string;
  repair_orders: { claim_number: string | null } | null;
}

function splitFromRaw(r: RawSplit): LedgerSplit {
  return {
    id: r.id,
    role: r.split_role ?? 'HOUSE',
    pct: r.tech_split_pct,
    grossAmount: r.gross_amount,
    netPayout: r.net_payout ?? 0,
    status: r.status,
    stripeTransferId: r.stripe_transfer_id,
  };
}

function groupLedgers(rows: RawSplit[]): RoLedger[] {
  const map = new Map<string, RoLedger>();
  for (const r of rows) {
    const claim = r.repair_orders?.claim_number ?? r.ro_id;
    const entry = map.get(r.ro_id) ?? { roId: r.ro_id, claim, splits: [] };
    entry.splits.push(splitFromRaw(r));
    map.set(r.ro_id, entry);
  }
  return [...map.values()];
}

/* ---- Sample fallback ------------------------------------------------------ */
const SAMPLE_LEDGERS: RoLedger[] = [
  {
    roId: 'mock-a6f5',
    claim: 'APX-2026-0005',
    splits: [
      { id: 's1', role: 'PDR_LEAD', pct: 50, grossAmount: 5000, netPayout: 2500, status: 'PAID', stripeTransferId: 'tr_seed_pdrlead_0005' },
      { id: 's2', role: 'SALES', pct: 10, grossAmount: 5000, netPayout: 500, status: 'PAID', stripeTransferId: 'tr_seed_sales_0005' },
      { id: 's3', role: 'HOUSE', pct: 40, grossAmount: 5000, netPayout: 2000, status: 'PENDING', stripeTransferId: null },
    ],
  },
];

const SAMPLE_POPS: PopReceipt[] = [
  {
    id: 'pop-1',
    claim: 'APX-2026-0005',
    amount: 5000,
    verified: true,
    imageUrl: 'https://storage.example.com/checks/APX-2026-0005.jpg',
    createdAt: '2026-07-20T00:00:00.000Z',
  },
];

function fmtMoney(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US');
}

export default function PayoutsCockpitPage() {
  const [ledgers, setLedgers] = useState<RoLedger[]>([]);
  const [pops, setPops] = useState<PopReceipt[]>([]);
  const [source, setSource] = useState<Source>('sample');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const [splitsRes, popsRes] = await Promise.all([
          supabase
            .from('payout_splits')
            .select(
              'id, ro_id, split_role, tech_split_pct, gross_amount, net_payout, status, stripe_transfer_id, repair_orders ( claim_number )',
            )
            .order('created_at', { ascending: true }),
          supabase
            .from('proof_of_payments')
            .select(
              'id, ro_id, check_amount, ocr_verified_flag, check_image_url, created_at, repair_orders ( claim_number )',
            )
            .order('created_at', { ascending: false }),
        ]);
        if (cancelled) return;

        const splitRows = (splitsRes.data ?? []) as unknown as RawSplit[];
        const popRows = (popsRes.data ?? []) as unknown as RawPop[];

        if (!splitsRes.error && splitRows.length > 0) {
          setLedgers(groupLedgers(splitRows));
          setPops(
            popRows.map((p) => ({
              id: p.id,
              claim: p.repair_orders?.claim_number ?? p.ro_id,
              amount: p.check_amount,
              verified: p.ocr_verified_flag,
              imageUrl: p.check_image_url,
              createdAt: p.created_at,
            })),
          );
          setSource('supabase');
        } else {
          setLedgers(SAMPLE_LEDGERS);
          setPops(SAMPLE_POPS);
          setSource('sample');
        }
      } catch {
        if (cancelled) return;
        setLedgers(SAMPLE_LEDGERS);
        setPops(SAMPLE_POPS);
        setSource('sample');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleExecute = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      let snapshot: RoLedger[] = [];
      setBusy(true);

      setLedgers((prev) => {
        snapshot = prev;
        return prev.map((l) => ({
          ...l,
          splits: l.splits.map((s) =>
            idSet.has(s.id) ? { ...s, status: 'PAID' as PayoutStatus } : s,
          ),
        }));
      });

      const finish = () => setBusy(false);

      if (source !== 'supabase') {
        finish();
        return;
      }

      void (async () => {
        const supabase = getSupabaseBrowserClient();
        const { error } = await supabase
          .from('payout_splits')
          .update({ status: 'PAID' })
          .in('id', ids);
        if (error) {
          setLedgers(snapshot);
          setNotice(`Could not execute payout: ${error.message}`);
        }
        finish();
      })();
    },
    [source],
  );

  const pendingTotal = useMemo(
    () =>
      ledgers
        .flatMap((l) => l.splits)
        .filter((s) => s.status === 'PENDING' || s.status === 'FAILED').length,
    [ledgers],
  );

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100">Payouts</h1>
          <p className="text-sm text-zinc-400">
            1099 split ledger · {ledgers.length} orders ·{' '}
            <span className={pendingTotal > 0 ? 'text-amber-300' : 'text-zinc-400'}>
              {pendingTotal} legs pending
            </span>
          </p>
        </div>
        <span
          className={
            source === 'supabase'
              ? 'rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300'
              : 'rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-400'
          }
        >
          {source === 'supabase' ? 'Live · Supabase' : 'Sample data'}
        </span>
      </header>

      {notice && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-red-300/70 hover:text-red-200"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
          Loading payouts…
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          {/* Proof-of-payment receipts */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h2 className="text-sm font-semibold text-zinc-100">Proof of Payment</h2>
              <p className="text-xs text-zinc-500">OCR-verified check receipts</p>
            </div>
            {pops.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-zinc-600">No receipts yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-800/70">
                {pops.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-sky-300">{p.claim}</p>
                      <p className="text-sm font-medium text-zinc-100">{fmtMoney(p.amount)}</p>
                      <p className="text-xs text-zinc-500">{fmtDate(p.createdAt)}</p>
                    </div>
                    <span
                      className={
                        p.verified
                          ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-emerald-300'
                          : 'rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-amber-300'
                      }
                    >
                      {p.verified ? 'Verified' : 'Unverified'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Split ledgers */}
          <div className="flex flex-col gap-4">
            {ledgers.length === 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-8 text-center text-sm text-zinc-600">
                No payout ledgers yet.
              </div>
            ) : (
              ledgers.map((l) => (
                <SplitLedgerTable
                  key={l.roId}
                  title={l.claim}
                  splits={l.splits}
                  busy={busy}
                  onExecute={handleExecute}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
