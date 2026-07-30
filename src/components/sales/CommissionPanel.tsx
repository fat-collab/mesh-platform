'use client';

/**
 * CommissionPanel — Executive-Controlled Commission & Lifecycle Tracker.
 *
 * Reports the SALES-role legs of the existing payout_splits ledger, each
 * paired with a real-time production status badge (the linked RO's current
 * board stage). Executives get an inline override control that writes to
 * commission_overrides — a dynamic configuration layer on top of the ledger,
 * not a new payroll engine: overriding never mutates payout_splits itself.
 */
import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { getCurrentProfile } from '@/lib/auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { fetchBoardOrders } from '@/lib/ops-data';
import { MOCK_BOARD_ORDERS } from '@/lib/ops-mock';
import { STAGE_META } from '@/lib/board';
import { getCommissionLedger, setCommissionOverride, type CommissionEntry } from '@/lib/commission-db';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

async function loadStageByClaim(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const supabase = getSupabaseBrowserClient();
    const { orders, error } = await fetchBoardOrders(supabase);
    const rows = !error && orders.length > 0 ? orders : MOCK_BOARD_ORDERS;
    for (const ro of rows) {
      if (ro.claim_number) map.set(ro.claim_number, ro.stage);
    }
  } catch {
    for (const ro of MOCK_BOARD_ORDERS) {
      if (ro.claim_number) map.set(ro.claim_number, ro.stage);
    }
  }
  return map;
}

function OverrideControl({
  entry,
  onSaved,
}: {
  entry: CommissionEntry;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pct, setPct] = useState(String(entry.effectivePct));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const value = Number(pct);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setError('Enter 0–100.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setCommissionOverride({ roId: entry.roId, overridePct: value });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save override.');
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setPct(String(entry.effectivePct));
          setEditing(true);
        }}
        className="rounded border border-zinc-700 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800"
      >
        Override
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={pct}
        onChange={(e) => setPct(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="w-14 rounded border border-zinc-700 bg-zinc-950/70 px-1.5 py-1 text-[11px] text-zinc-100 focus:outline-none"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="rounded bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
      >
        Save
      </button>
      {error && <span className="text-[11px] text-red-300">{error}</span>}
    </div>
  );
}

export function CommissionPanel() {
  const [entries, setEntries] = useState<CommissionEntry[]>([]);
  const [stageByClaim, setStageByClaim] = useState<Map<string, string>>(new Map());
  const [isExecutive, setIsExecutive] = useState(false);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    const [ledger, stages] = await Promise.all([getCommissionLedger(), loadStageByClaim()]);
    setEntries(ledger);
    setStageByClaim(stages);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getCurrentProfile(getSupabaseBrowserClient());
        if (!cancelled) setIsExecutive(profile?.role === 'EXECUTIVE');
      } catch {
        /* default: not executive */
      }
      await refetch();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refetch]);

  const totalNet = entries.reduce((s, e) => s + e.netPayout, 0);

  if (loading) {
    return <p className="py-8 text-center text-sm text-zinc-500">Loading commission ledger…</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Commission &amp; Lifecycle Tracker</h3>
          <p className="text-xs text-zinc-500">
            SALES split legs · {entries.length} deal(s) · Total {money(totalNet)}
          </p>
        </div>
        {!isExecutive && (
          <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-400">
            Read-only — Executive override required
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-zinc-600">No SALES commission legs yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-2 font-medium">Rep</th>
              <th className="px-4 py-2 font-medium">Claim</th>
              <th className="px-4 py-2 font-medium">Production status</th>
              <th className="px-4 py-2 text-right font-medium">Gross</th>
              <th className="px-4 py-2 text-right font-medium">Pct</th>
              <th className="px-4 py-2 text-right font-medium">Net</th>
              {isExecutive && <th className="px-4 py-2 text-right font-medium">Override</th>}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const stage = stageByClaim.get(e.claimNumber);
              const stageMeta = stage ? STAGE_META[stage as keyof typeof STAGE_META] : null;
              return (
                <tr key={e.splitId} className="border-t border-zinc-800/70">
                  <td className="px-4 py-2.5 text-zinc-200">{e.repName ?? 'Unassigned'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-sky-300">{e.claimNumber}</td>
                  <td className="px-4 py-2.5">
                    {stageMeta ? (
                      <span
                        className={clsx(
                          'inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-semibold',
                          stageMeta.tone === 'red' && 'border-red-500/40 bg-red-500/10 text-red-300',
                          stageMeta.tone === 'amber' && 'border-amber-500/40 bg-amber-500/10 text-amber-300',
                          stageMeta.tone === 'neutral' && 'border-zinc-600/50 bg-zinc-700/30 text-zinc-300',
                        )}
                      >
                        {stageMeta.label}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-400">
                    {money(e.grossAmount)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-300">
                    {e.overridden ? (
                      <span className="text-amber-300">{e.effectivePct}%*</span>
                    ) : (
                      `${e.effectivePct}%`
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums text-zinc-100">
                    {money(e.netPayout)}
                  </td>
                  {isExecutive && (
                    <td className="px-4 py-2.5 text-right">
                      <OverrideControl entry={e} onSaved={() => void refetch()} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-600">
        * Overridden by an executive — the underlying payout split's base percentage is unchanged.
      </p>
    </div>
  );
}
