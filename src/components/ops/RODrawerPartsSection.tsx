'use client';

/**
 * RODrawerPartsSection — parts procurement panel for the RO Detail Drawer.
 *
 * Lists the repair order's parts, and lets a manager add parts, advance their
 * procurement status, and remove them. Backed by parts-db (DB-first with a
 * session-local fallback), so it works whether or not the repair_order_parts
 * table is present.
 */
import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { getParts, addPart, updatePartStatus, removePart } from '@/lib/parts-db';
import {
  PART_STATUS_LABEL,
  PART_STATUS_ORDER,
  PART_TYPE_LABEL,
  type PartStatus,
  type PartType,
  type RepairOrderPart,
} from '@/components/ops/ro-parts-types';

const TYPE_TONE: Record<PartType, string> = {
  OEM: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  AFTERMARKET: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  SALVAGE: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
  USED: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
};

const STATUS_TONE: Record<PartStatus, string> = {
  NEEDED: 'border-zinc-600/60 bg-zinc-700/40 text-zinc-300',
  ORDERED: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  SHIPPED: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  RECEIVED: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  RETURNED: 'border-red-500/50 bg-red-500/15 text-red-200',
};

const PART_TYPE_ORDER: PartType[] = ['OEM', 'AFTERMARKET', 'SALVAGE', 'USED'];

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export interface RODrawerPartsSectionProps {
  repairOrderId: string;
}

export function RODrawerPartsSection({ repairOrderId }: RODrawerPartsSectionProps) {
  const [open, setOpen] = useState(true);
  const [parts, setParts] = useState<RepairOrderPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Add-form fields.
  const [partName, setPartName] = useState('');
  const [partNumber, setPartNumber] = useState('');
  const [vendor, setVendor] = useState('');
  const [partType, setPartType] = useState<PartType>('OEM');
  const [cost, setCost] = useState('');
  const [eta, setEta] = useState('');

  const refresh = useCallback(async () => {
    setParts(await getParts(repairOrderId));
  }, [repairOrderId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const rows = await getParts(repairOrderId);
      if (cancelled) return;
      setParts(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [repairOrderId]);

  const handleAdd = async () => {
    const name = partName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await addPart(repairOrderId, {
        partName: name,
        partNumber: partNumber.trim() || undefined,
        vendor: vendor.trim() || undefined,
        partType,
        cost: parseFloat(cost) || 0,
        eta: eta.trim() || undefined,
      });
      setPartName('');
      setPartNumber('');
      setVendor('');
      setPartType('OEM');
      setCost('');
      setEta('');
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id: string, status: PartStatus) => {
    // Optimistic: reflect immediately, then persist.
    setParts((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));
    await updatePartStatus(id, status);
  };

  const handleRemove = async (id: string) => {
    await removePart(id);
    await refresh();
  };

  const partsTotal = parts.reduce((sum, p) => sum + p.cost, 0);

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
          Parts Procurement{parts.length > 0 ? ` · ${parts.length}` : ''}
        </h3>
        <span className="text-zinc-500">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          {loading ? (
            <p className="text-xs text-zinc-500">Loading parts…</p>
          ) : parts.length === 0 ? (
            <p className="text-xs text-zinc-500">No parts on this order yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {parts.map((p) => (
                <li
                  key={p.id}
                  className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={clsx(
                          'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold',
                          TYPE_TONE[p.partType],
                        )}
                      >
                        {PART_TYPE_LABEL[p.partType]}
                      </span>
                      <span className="truncate text-sm text-zinc-100">{p.partName}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs tabular-nums text-emerald-300">{money(p.cost)}</span>
                      <button
                        type="button"
                        onClick={() => void handleRemove(p.id)}
                        aria-label={`Remove ${p.partName}`}
                        className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-300"
                      >
                        ✕
                      </button>
                    </span>
                  </div>

                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[11px] text-zinc-500">
                      {[p.partNumber, p.vendor].filter(Boolean).join(' · ') || '—'}
                      {p.eta ? ` · ETA ${p.eta}` : ''}
                    </span>
                    <select
                      value={p.status}
                      onChange={(e) => void handleStatus(p.id, e.target.value as PartStatus)}
                      aria-label={`Status for ${p.partName}`}
                      className={clsx(
                        'shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold focus:outline-none',
                        STATUS_TONE[p.status],
                      )}
                    >
                      {PART_STATUS_ORDER.map((s) => (
                        <option key={s} value={s} className="bg-zinc-900 text-zinc-200">
                          {PART_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {parts.length > 0 && (
            <div className="flex justify-between border-t border-zinc-800 pt-2 text-xs">
              <span className="text-zinc-500">Parts total</span>
              <span className="font-semibold tabular-nums text-zinc-200">{money(partsTotal)}</span>
            </div>
          )}

          {/* Add part */}
          <div className="space-y-2 border-t border-zinc-800 pt-3">
            <input
              value={partName}
              onChange={(e) => setPartName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAdd();
              }}
              placeholder="Part name"
              aria-label="Part name"
              className={clsx(inputCls, 'w-full')}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={partNumber}
                onChange={(e) => setPartNumber(e.target.value)}
                placeholder="Part #"
                aria-label="Part number"
                className={inputCls}
              />
              <input
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="Vendor"
                aria-label="Vendor"
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={partType}
                onChange={(e) => setPartType(e.target.value as PartType)}
                aria-label="Part type"
                className={inputCls}
              >
                {PART_TYPE_ORDER.map((t) => (
                  <option key={t} value={t} className="bg-zinc-900">
                    {PART_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <input
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                inputMode="decimal"
                placeholder="Cost ($)"
                aria-label="Cost"
                className={inputCls}
              />
              <input
                type="date"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                aria-label="ETA"
                className={inputCls}
              />
            </div>
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={!partName.trim() || saving}
              className="w-full rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add Part'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
