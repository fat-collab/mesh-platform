'use client';

/**
 * RODrawerLaborSection — labor & technician time-tracking panel for the RO
 * Detail Drawer.
 *
 * Lists labor operations with a shop efficiency ratio (total estimated ÷ total
 * actual hours), an add form, per-row clock-in/out toggle, editable actual
 * hours, and removal. Backed by labor-db (DB-first with a session-local
 * fallback), so it works whether or not the repair_order_labor table exists.
 */
import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  getLaborEntries,
  addLaborEntry,
  toggleClock,
  updateActualHours,
  removeLaborEntry,
} from '@/lib/labor-db';
import {
  LABOR_STATUS_LABEL,
  type LaborStatus,
  type RepairOrderLaborEntry,
} from '@/components/ops/ro-labor-types';

const STATUS_TONE: Record<LaborStatus, string> = {
  PENDING: 'border-zinc-600/60 bg-zinc-700/40 text-zinc-300',
  IN_PROGRESS: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  COMPLETED: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
};

const hrs = (n: number) => `${n.toFixed(1)}h`;

export interface RODrawerLaborSectionProps {
  repairOrderId: string;
}

export function RODrawerLaborSection({ repairOrderId }: RODrawerLaborSectionProps) {
  const [open, setOpen] = useState(true);
  const [entries, setEntries] = useState<RepairOrderLaborEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Add-form fields.
  const [operationName, setOperationName] = useState('');
  const [technicianName, setTechnicianName] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');

  const refresh = useCallback(async () => {
    setEntries(await getLaborEntries(repairOrderId));
  }, [repairOrderId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const rows = await getLaborEntries(repairOrderId);
      if (cancelled) return;
      setEntries(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [repairOrderId]);

  const handleAdd = async () => {
    const op = operationName.trim();
    const tech = technicianName.trim();
    if (!op || !tech || saving) return;
    setSaving(true);
    try {
      await addLaborEntry(repairOrderId, {
        operationName: op,
        technicianName: tech,
        estimatedHours: parseFloat(estimatedHours) || 0,
      });
      setOperationName('');
      setTechnicianName('');
      setEstimatedHours('');
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleClock = async (id: string, action: 'IN' | 'OUT') => {
    await toggleClock(id, action);
    await refresh();
  };

  const handleActual = async (id: string, value: string) => {
    const hours = parseFloat(value);
    if (Number.isNaN(hours) || hours < 0) return;
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, actualHours: hours } : e)));
    await updateActualHours(id, hours);
  };

  const handleRemove = async (id: string) => {
    await removeLaborEntry(id);
    await refresh();
  };

  const totalEstimated = entries.reduce((s, e) => s + e.estimatedHours, 0);
  const totalActual = entries.reduce((s, e) => s + e.actualHours, 0);
  // Efficiency: estimated ÷ actual. >100% = under book time (favorable).
  const efficiency = totalActual > 0 ? (totalEstimated / totalActual) * 100 : null;
  const effTone =
    efficiency == null
      ? 'text-zinc-400'
      : efficiency >= 100
        ? 'text-emerald-300'
        : efficiency >= 85
          ? 'text-amber-300'
          : 'text-red-300';

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
          Labor &amp; Time{entries.length > 0 ? ` · ${entries.length}` : ''}
        </h3>
        <span className="text-zinc-500">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          {/* Efficiency ratio */}
          <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5">
            <div className="text-[11px] text-zinc-500">
              Est <span className="tabular-nums text-zinc-300">{hrs(totalEstimated)}</span>
              <span className="mx-1 text-zinc-600">·</span>
              Act <span className="tabular-nums text-zinc-300">{hrs(totalActual)}</span>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Efficiency </span>
              <span className={clsx('text-sm font-semibold tabular-nums', effTone)}>
                {efficiency == null ? '—' : `${efficiency.toFixed(0)}%`}
              </span>
            </div>
          </div>

          {loading ? (
            <p className="text-xs text-zinc-500">Loading labor…</p>
          ) : entries.length === 0 ? (
            <p className="text-xs text-zinc-500">No labor operations logged yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {entries.map((e) => {
                const clockedIn = Boolean(e.clockedInAt) && !e.clockedOutAt;
                return (
                  <li
                    key={e.id}
                    className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={clsx(
                            'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold',
                            STATUS_TONE[e.status],
                          )}
                        >
                          {LABOR_STATUS_LABEL[e.status]}
                        </span>
                        <span className="truncate text-sm text-zinc-100">{e.operationName}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleRemove(e.id)}
                        aria-label={`Remove ${e.operationName}`}
                        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-300"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[11px] text-zinc-500">
                        {e.technicianName} · Est {hrs(e.estimatedHours)}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <label className="flex items-center gap-1 text-[11px] text-zinc-500">
                          Act
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            defaultValue={e.actualHours}
                            onBlur={(ev) => void handleActual(e.id, ev.target.value)}
                            aria-label={`Actual hours for ${e.operationName}`}
                            className={clsx(inputCls, 'w-14 text-right')}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => void handleClock(e.id, clockedIn ? 'OUT' : 'IN')}
                          className={clsx(
                            'rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors',
                            clockedIn
                              ? 'border-red-500/50 bg-red-500/10 text-red-200 hover:bg-red-500/20'
                              : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20',
                          )}
                        >
                          {clockedIn ? 'Clock Out' : 'Clock In'}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Add operation */}
          <div className="space-y-2 border-t border-zinc-800 pt-3">
            <input
              value={operationName}
              onChange={(e) => setOperationName(e.target.value)}
              placeholder="Operation (e.g. Blend LH quarter)"
              aria-label="Operation name"
              className={clsx(inputCls, 'w-full')}
            />
            <div className="grid grid-cols-[1fr_5rem_auto] gap-2">
              <input
                value={technicianName}
                onChange={(e) => setTechnicianName(e.target.value)}
                placeholder="Technician"
                aria-label="Technician name"
                className={inputCls}
              />
              <input
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                inputMode="decimal"
                placeholder="Est h"
                aria-label="Estimated hours"
                className={clsx(inputCls, 'text-right')}
              />
              <button
                type="button"
                onClick={() => void handleAdd()}
                disabled={!operationName.trim() || !technicianName.trim() || saving}
                className="rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
              >
                {saving ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
