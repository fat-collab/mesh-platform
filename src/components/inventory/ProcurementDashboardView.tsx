'use client';

/**
 * ProcurementDashboardView — parts-only procurement engine.
 *
 * Tabs:
 *  1) Parts Request Queue — un-ordered parts (parts_line_items NEEDED) across
 *     active ROs, with a per-RO "Generate PO" action.
 *  2) Active Purchase Orders — outbound POs tied back to their RO (claim).
 *  3) Catalog & Vendors — the existing inventory catalog / price-matrix view.
 */
import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  getPartsRequestQueue,
  getActivePurchaseOrders,
  generatePurchaseOrder,
  updatePurchaseOrderStatus,
} from '@/lib/procurement-db';
import {
  PO_STATUS_LABEL,
  PO_STATUS_ORDER,
  type PartsRequestGroup,
  type ProcurementPO,
  type ProcurementPOStatus,
} from '@/components/inventory/procurement-types';
import { PART_SOURCING_LABEL } from '@/components/ops/types';
import { InventoryManagementView } from '@/components/inventory/InventoryManagementView';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

type Tab = 'queue' | 'pos' | 'catalog';

const PO_STATUS_TONE: Record<ProcurementPOStatus, string> = {
  DRAFT: 'border-zinc-600/60 bg-zinc-700/40 text-zinc-300',
  SENT: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  RECEIVED: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
};

// --- Tab 1: Parts Request Queue --------------------------------------------
function PartsRequestQueuePanel({ onGenerated }: { onGenerated: () => void }) {
  const [groups, setGroups] = useState<PartsRequestGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setGroups(await getPartsRequestQueue());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await getPartsRequestQueue();
      if (!cancelled) {
        setGroups(rows);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleGenerate = async (group: PartsRequestGroup) => {
    if (busy) return;
    setBusy(group.claimNumber);
    setNotice(null);
    try {
      await generatePurchaseOrder(group.claimNumber, group.parts);
      setNotice(`PO drafted for ${group.claimNumber} — ${group.parts.length} part(s) marked Ordered.`);
      await refresh();
      onGenerated();
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <p className="py-8 text-center text-sm text-zinc-500">Loading parts queue…</p>;
  }

  return (
    <div className="space-y-3">
      {notice && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {notice}
        </div>
      )}
      {groups.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
          No un-ordered parts across active repair orders.
        </div>
      ) : (
        groups.map((g) => {
          const total = g.parts.reduce((s, p) => s + (p.unitCost ?? 0) * (p.quantity ?? 1), 0);
          return (
            <div key={g.claimNumber} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-sky-300">{g.claimNumber}</p>
                  <p className="truncate text-[11px] text-zinc-500">
                    {g.customerName ?? '—'} · {g.vehicle} · {g.parts.length} part(s) needed
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleGenerate(g)}
                  disabled={busy === g.claimNumber}
                  className="shrink-0 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
                >
                  {busy === g.claimNumber ? 'Generating…' : 'Generate PO'}
                </button>
              </div>
              <ul className="divide-y divide-zinc-800/70 rounded-md border border-zinc-800">
                {g.parts.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                    <span className="min-w-0 truncate text-zinc-200">{p.name}</span>
                    <span className="flex shrink-0 items-center gap-2 text-zinc-500">
                      <span className="rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-[10px] font-semibold">
                        {PART_SOURCING_LABEL[p.sourcingTier]}
                      </span>
                      <span className="tabular-nums">×{p.quantity ?? 1}</span>
                      <span className="tabular-nums text-zinc-400">{money(p.unitCost ?? 0)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-1.5 flex justify-end text-[11px] text-zinc-500">
                Est. total <span className="ml-1 font-semibold tabular-nums text-zinc-300">{money(total)}</span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// --- Tab 2: Active Purchase Orders -----------------------------------------
function ActivePurchaseOrdersPanel({ reloadKey }: { reloadKey: number }) {
  const [pos, setPos] = useState<ProcurementPO[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setPos(await getActivePurchaseOrders());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const rows = await getActivePurchaseOrders();
      if (!cancelled) {
        setPos(rows);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const handleStatus = async (poId: string, status: ProcurementPOStatus) => {
    setPos((prev) => prev.map((p) => (p.id === poId ? { ...p, status } : p)));
    await updatePurchaseOrderStatus(poId, status);
    await refresh();
  };

  if (loading) {
    return <p className="py-8 text-center text-sm text-zinc-500">Loading purchase orders…</p>;
  }
  if (pos.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
        No purchase orders yet — generate one from the Parts Request Queue.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pos.map((po) => {
        const total = po.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
        return (
          <div key={po.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold text-sky-300">
                  {po.claimNumber} <span className="text-zinc-600">· RO</span>
                </p>
                <p className="text-[11px] text-zinc-500">
                  {po.items.length} line(s) · {new Date(po.createdAt).toLocaleDateString()}
                </p>
              </div>
              <select
                value={po.status}
                onChange={(e) => void handleStatus(po.id, e.target.value as ProcurementPOStatus)}
                aria-label={`Status for PO on ${po.claimNumber}`}
                className={clsx(
                  'shrink-0 rounded-md border px-1.5 py-1 text-[11px] font-semibold focus:outline-none',
                  PO_STATUS_TONE[po.status],
                )}
              >
                {PO_STATUS_ORDER.map((s) => (
                  <option key={s} value={s} className="bg-zinc-900 text-zinc-200">
                    {PO_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <ul className="divide-y divide-zinc-800/70 rounded-md border border-zinc-800">
              {po.items.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                  <span className="min-w-0 truncate text-zinc-200">{it.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-zinc-500">
                    <span className="tabular-nums">×{it.quantity}</span>
                    <span className="tabular-nums text-zinc-400">{money(it.unitPrice)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-1.5 flex justify-end text-[11px] text-zinc-500">
              PO total <span className="ml-1 font-semibold tabular-nums text-zinc-300">{money(total)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProcurementDashboardView() {
  const [tab, setTab] = useState<Tab>('queue');
  // Bumped when a PO is generated so the Active POs tab refetches on next view.
  const [poReloadKey, setPoReloadKey] = useState(0);

  const TABS: { id: Tab; label: string }[] = [
    { id: 'queue', label: 'Parts Request Queue' },
    { id: 'pos', label: 'Active Purchase Orders' },
    { id: 'catalog', label: 'Catalog & Vendors' },
  ];

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={
              tab === t.id
                ? 'rounded-md bg-sky-500/20 px-3 py-1.5 text-sm font-semibold text-sky-200'
                : 'rounded-md px-3 py-1.5 text-sm font-medium text-zinc-400 hover:text-zinc-200'
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'queue' && (
        <PartsRequestQueuePanel onGenerated={() => setPoReloadKey((k) => k + 1)} />
      )}
      {tab === 'pos' && <ActivePurchaseOrdersPanel reloadKey={poReloadKey} />}
      {tab === 'catalog' && <InventoryManagementView />}
    </div>
  );
}
