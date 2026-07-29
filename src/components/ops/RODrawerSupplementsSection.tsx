'use client';

/**
 * RODrawerSupplementsSection — per-RO view of the canonical carrier supplement
 * records (SupplementRecord / supplement-db), keyed by the RO's claim number.
 *
 * Shows approved / pending (unpaid) totals, lets a manager draft a quick
 * supplement, advance its payment lifecycle, or remove it. Full multi-line /
 * carrier-packet editing lives on the Supplements dashboard; this is the
 * in-drawer quick view. (Supersedes the retired RO-scoped supplements-db.)
 */
import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  getSupplementsForRO,
  approvedSupplementTotal,
  saveSupplement,
  updateSupplementStatus,
  deleteSupplement,
  genSupplementId,
} from '@/lib/supplement-db';
import {
  LIFECYCLE_LABEL,
  LIFECYCLE_ORDER,
  UNPAID_LIFECYCLE,
  type SupplementLifecycle,
  type SupplementRecord,
} from '@/components/supplements/types';

const LIFECYCLE_TONE: Record<SupplementLifecycle, string> = {
  DRAFT: 'border-zinc-600/60 bg-zinc-700/40 text-zinc-300',
  SUBMITTED: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  APPROVED_PENDING_PAYMENT: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  PAID: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
};

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export interface RODrawerSupplementsSectionProps {
  repairOrderId: string;
  claimNumber: string;
  customerName: string | null;
  vehicle: string;
  insuranceCarrier: string;
}

export function RODrawerSupplementsSection({
  repairOrderId,
  claimNumber,
  customerName,
  vehicle,
  insuranceCarrier,
}: RODrawerSupplementsSectionProps) {
  const [open, setOpen] = useState(true);
  const [records, setRecords] = useState<SupplementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Quick-draft fields.
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [adjusterName, setAdjusterName] = useState('');
  const [adjusterPhone, setAdjusterPhone] = useState('');
  const [notes, setNotes] = useState('');

  const refresh = useCallback(async () => {
    setRecords(await getSupplementsForRO(repairOrderId, claimNumber));
  }, [repairOrderId, claimNumber]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const rows = await getSupplementsForRO(repairOrderId, claimNumber);
      if (cancelled) return;
      setRecords(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [repairOrderId, claimNumber]);

  const handleAdd = async () => {
    const desc = description.trim();
    const amt = parseFloat(amount) || 0;
    if (!desc || saving) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const record: SupplementRecord = {
        id: genSupplementId('supp'),
        roId: repairOrderId,
        customerName: customerName ?? '',
        vehicleInfo: vehicle,
        insuranceCarrier,
        claimNumber,
        lifecycleStatus: 'DRAFT',
        items: [
          {
            id: genSupplementId('item'),
            description: desc,
            category: 'PARTS',
            originalCost: 0,
            requestedCost: amt,
            status: 'PENDING',
          },
        ],
        totalDeltaAmount: amt, // saveSupplement recomputes from items
        carrierNotes: notes.trim(),
        adjusterName: adjusterName.trim() || undefined,
        adjusterPhone: adjusterPhone.trim() || undefined,
        createdAt: now,
      };
      await saveSupplement(record);
      setDescription('');
      setAmount('');
      setAdjusterName('');
      setAdjusterPhone('');
      setNotes('');
      setFormOpen(false);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id: string, status: SupplementLifecycle) => {
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, lifecycleStatus: status } : r)));
    await updateSupplementStatus(id, status);
    await refresh();
  };

  const handleRemove = async (id: string) => {
    await deleteSupplement(id);
    await refresh();
  };

  const approvedTotal = approvedSupplementTotal(records);
  const pendingTotal = records
    .filter((r) => UNPAID_LIFECYCLE.includes(r.lifecycleStatus))
    .reduce((s, r) => s + r.totalDeltaAmount, 0);

  const inputCls =
    'rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40';

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Supplements{records.length > 0 ? ` · ${records.length}` : ''}
        </h3>
        <span className="text-zinc-500">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          {/* Financial totals */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wider text-emerald-400/80">Approved</p>
              <p className="text-sm font-semibold tabular-nums text-emerald-300">
                {money(approvedTotal)}
              </p>
            </div>
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wider text-amber-400/80">Pending</p>
              <p className="text-sm font-semibold tabular-nums text-amber-200">
                {money(pendingTotal)}
              </p>
            </div>
          </div>

          {loading ? (
            <p className="text-xs text-zinc-500">Loading supplements…</p>
          ) : records.length === 0 ? (
            <p className="text-xs text-zinc-500">No supplements on this order yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {records.map((r) => (
                <li
                  key={r.id}
                  className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="text-xs tabular-nums text-emerald-300">
                        {money(r.totalDeltaAmount)}
                      </span>
                      <span className="truncate text-[11px] text-zinc-500">
                        {r.items.length} line(s)
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleRemove(r.id)}
                      aria-label="Remove supplement"
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-300"
                    >
                      ✕
                    </button>
                  </div>
                  {(r.adjusterName || r.carrierNotes) && (
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                      {r.adjusterName ?? ''}
                      {r.carrierNotes ? `${r.adjusterName ? ' — ' : ''}${r.carrierNotes}` : ''}
                    </p>
                  )}
                  <div className="mt-1 flex items-center justify-end">
                    <select
                      value={r.lifecycleStatus}
                      onChange={(e) => void handleStatus(r.id, e.target.value as SupplementLifecycle)}
                      aria-label="Supplement lifecycle status"
                      className={clsx(
                        'shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold focus:outline-none',
                        LIFECYCLE_TONE[r.lifecycleStatus],
                      )}
                    >
                      {LIFECYCLE_ORDER.map((s) => (
                        <option key={s} value={s} className="bg-zinc-900 text-zinc-200">
                          {LIFECYCLE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Quick draft */}
          <div className="border-t border-zinc-800 pt-3">
            {formOpen ? (
              <div className="space-y-2">
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Supplement description"
                  aria-label="Supplement description"
                  className={clsx(inputCls, 'w-full')}
                />
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="Requested amount ($)"
                  aria-label="Requested amount"
                  className={clsx(inputCls, 'w-full')}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={adjusterName}
                    onChange={(e) => setAdjusterName(e.target.value)}
                    placeholder="Adjuster name"
                    aria-label="Adjuster name"
                    className={inputCls}
                  />
                  <input
                    value={adjusterPhone}
                    onChange={(e) => setAdjusterPhone(e.target.value)}
                    placeholder="Adjuster phone"
                    aria-label="Adjuster phone"
                    className={inputCls}
                  />
                </div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Carrier notes…"
                  aria-label="Carrier notes"
                  className={clsx(inputCls, 'w-full resize-none')}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleAdd()}
                    disabled={!description.trim() || saving}
                    className="flex-1 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save Draft'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormOpen(false)}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="w-full rounded-md border border-dashed border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              >
                + New Supplement Draft
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
