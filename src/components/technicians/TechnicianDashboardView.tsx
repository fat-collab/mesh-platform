'use client';

/**
 * TechnicianDashboardView — the Technician Hub.
 *
 *  • Active Operation Queue — assigned labor lines across active ROs, filterable
 *    by technician (IN_PROGRESS → PENDING → COMPLETED).
 *  • Live Clock-In / Clock-Out — bound to labor-db.toggleClock; clock-out
 *    accrues elapsed time into actual hours.
 *  • Daily Efficiency Gauge — estimated ÷ actual hours over the selected tech.
 *
 * Reads via labor-db.getActiveLaborQueue (which aggregates ops-data board orders
 * + per-RO labor); writes via toggleClock / updateActualHours.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { getActiveLaborQueue, toggleClock, updateActualHours } from '@/lib/labor-db';
import { LABOR_STATUS_LABEL, type ActiveLaborLine, type LaborStatus } from '@/components/ops/ro-labor-types';

const STATUS_TONE: Record<LaborStatus, string> = {
  PENDING: 'border-zinc-600/60 bg-zinc-700/40 text-zinc-300',
  IN_PROGRESS: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  COMPLETED: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
};

// Sort order for the queue: in-progress work first, then pending, then done.
const STATUS_RANK: Record<LaborStatus, number> = {
  IN_PROGRESS: 0,
  PENDING: 1,
  COMPLETED: 2,
};

const hrs = (n: number) => `${n.toFixed(1)}h`;

function isClockedIn(line: ActiveLaborLine): boolean {
  return Boolean(line.entry.clockedInAt) && !line.entry.clockedOutAt;
}

export function TechnicianDashboardView() {
  const [lines, setLines] = useState<ActiveLaborLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [tech, setTech] = useState<string>('ALL');
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLines(await getActiveLaborQueue());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await getActiveLaborQueue();
      if (!cancelled) {
        setLines(rows);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const technicians = useMemo(() => {
    const names = new Set(lines.map((l) => l.entry.technicianName).filter(Boolean));
    return Array.from(names).sort();
  }, [lines]);

  const filtered = useMemo(() => {
    const list = tech === 'ALL' ? lines : lines.filter((l) => l.entry.technicianName === tech);
    return [...list].sort((a, b) => STATUS_RANK[a.entry.status] - STATUS_RANK[b.entry.status]);
  }, [lines, tech]);

  const totalEst = filtered.reduce((s, l) => s + l.entry.estimatedHours, 0);
  const totalAct = filtered.reduce((s, l) => s + l.entry.actualHours, 0);
  const efficiency = totalAct > 0 ? totalEst / totalAct : null;
  const activeCount = filtered.filter((l) => l.entry.status === 'IN_PROGRESS').length;

  // Gauge fill: cap the bar at 150% so a huge ratio doesn't blow out the track.
  const gaugePct = efficiency == null ? 0 : Math.min(efficiency, 1.5) / 1.5 * 100;
  const effTone =
    efficiency == null
      ? { text: 'text-zinc-400', bar: 'bg-zinc-600' }
      : efficiency >= 1
        ? { text: 'text-emerald-300', bar: 'bg-emerald-500' }
        : efficiency >= 0.85
          ? { text: 'text-amber-300', bar: 'bg-amber-500' }
          : { text: 'text-red-300', bar: 'bg-red-500' };

  const handleClock = async (line: ActiveLaborLine) => {
    if (busy) return;
    setBusy(line.entry.id);
    try {
      await toggleClock(line.entry.id, isClockedIn(line) ? 'OUT' : 'IN');
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const handleActual = async (id: string, value: string) => {
    const n = parseFloat(value);
    if (Number.isNaN(n) || n < 0) return;
    setLines((prev) =>
      prev.map((l) => (l.entry.id === id ? { ...l, entry: { ...l.entry, actualHours: n } } : l)),
    );
    await updateActualHours(id, n);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
        Loading operation queue…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Controls + KPIs */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Technician selector */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Technician</p>
          <select
            value={tech}
            onChange={(e) => setTech(e.target.value)}
            aria-label="Technician"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1.5 text-sm font-semibold text-zinc-100 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
          >
            <option value="ALL" className="bg-zinc-900">All technicians</option>
            {technicians.map((t) => (
              <option key={t} value={t} className="bg-zinc-900">
                {t}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[11px] text-zinc-500">
            {filtered.length} operation(s) · <span className="text-sky-300">{activeCount} clocked in</span>
          </p>
        </div>

        {/* Daily efficiency gauge */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              Daily Efficiency
            </p>
            <span className={clsx('text-2xl font-bold tabular-nums', effTone.text)}>
              {efficiency == null ? '—' : `${(efficiency * 100).toFixed(0)}%`}
            </span>
          </div>
          <div className="relative mt-2 h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div className={clsx('h-full rounded-full transition-all', effTone.bar)} style={{ width: `${gaugePct}%` }} />
            {/* 100% (on-book) marker at 2/3 of the 150%-capped track */}
            <div className="absolute inset-y-0 left-[66.6%] w-px bg-zinc-500/70" aria-hidden />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-zinc-500">
            <span>Est <span className="tabular-nums text-zinc-300">{hrs(totalEst)}</span></span>
            <span className="text-zinc-600">100% = on book</span>
            <span>Act <span className="tabular-nums text-zinc-300">{hrs(totalAct)}</span></span>
          </div>
        </div>
      </div>

      {/* Active operation queue */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-200">Active Operation Queue</h2>
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
            No assigned operations.
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((line) => {
              const e = line.entry;
              const clockedIn = isClockedIn(line);
              return (
                <li
                  key={e.id}
                  className={clsx(
                    'rounded-lg border bg-zinc-900/60 p-3',
                    clockedIn ? 'border-sky-500/40' : 'border-zinc-800',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={clsx(
                            'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold',
                            STATUS_TONE[e.status],
                          )}
                        >
                          {LABOR_STATUS_LABEL[e.status]}
                        </span>
                        <span className="truncate text-sm font-semibold text-zinc-100">
                          {e.operationName}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                        {e.technicianName || 'Unassigned'} · {line.claimNumber ?? 'NO CLAIM'} · {line.vehicle}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleClock(line)}
                      disabled={busy === e.id}
                      className={clsx(
                        'shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50',
                        clockedIn
                          ? 'border-red-500/50 bg-red-500/10 text-red-200 hover:bg-red-500/20'
                          : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20',
                      )}
                    >
                      {busy === e.id ? '…' : clockedIn ? '■ Clock Out' : '▶ Clock In'}
                    </button>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-zinc-800/70 pt-2 text-[11px]">
                    <span className="text-zinc-500">
                      Est <span className="tabular-nums text-zinc-300">{hrs(e.estimatedHours)}</span>
                      {clockedIn && e.clockedInAt && (
                        <span className="ml-2 text-sky-300">
                          ● in since {new Date(e.clockedInAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </span>
                      )}
                    </span>
                    <label className="flex items-center gap-1 text-zinc-500">
                      Act
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        defaultValue={e.actualHours}
                        onBlur={(ev) => void handleActual(e.id, ev.target.value)}
                        aria-label={`Actual hours for ${e.operationName}`}
                        className="w-16 rounded-md border border-zinc-700 bg-zinc-950/70 px-1.5 py-0.5 text-right text-xs text-zinc-100 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
                      />
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
