'use client';

/**
 * AuditHistoryView — hold-gate activity stream + timing bottleneck analytics.
 *
 * Fetches hold_gate_logs via the data layer and falls back to sample events
 * when the table is empty/unseeded so the view always renders. Provides metric
 * cards (avg resolution time, bottleneck category, resolved count), quick
 * filters by hold category, and a claim/VIN search over a chronological feed.
 */
import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { fetchHoldGateLogs } from '@/lib/ops-db';
import { MOCK_AUDIT_LOG } from '@/lib/ops-mock';
import {
  AUDIT_FILTER_CATEGORIES,
  HOLD_ACTION_LABEL,
  HOLD_CATEGORY_LABEL,
  type AuditLogEntry,
  type HoldAction,
  type HoldCategory,
} from './types';

type CategoryFilter = HoldCategory | 'all';

const CATEGORY_TONE: Record<HoldCategory, string> = {
  Parts: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  Insurance: 'border-violet-500/40 bg-violet-500/15 text-violet-200',
  Tech: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  Sublet: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200',
  'Total Loss': 'border-red-500/40 bg-red-500/15 text-red-200',
};

const ACTION_TONE: Record<HoldAction, string> = {
  PLACED_ON_HOLD: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  RESOLVED: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  OVERRIDDEN: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
};

function hoursBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000;
}

function formatDuration(hours: number): string {
  if (!isFinite(hours) || hours < 0) return '—';
  return hours < 48 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-100">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

export function AuditHistoryView() {
  const [entries, setEntries] = useState<AuditLogEntry[]>(MOCK_AUDIT_LOG);
  const [source, setSource] = useState<'supabase' | 'sample'>('sample');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { entries: rows, error } = await fetchHoldGateLogs();
      if (cancelled) return;
      if (!error && rows.length > 0) {
        setEntries(rows);
        setSource('supabase');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const analytics = useMemo(() => {
    const closed = entries.filter((e) => e.resolvedAt);
    const durations = closed.map((e) => hoursBetween(e.lockedAt, e.resolvedAt as string));
    const avg =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : NaN;

    // Average duration per category → bottleneck = highest average.
    const byCategory = new Map<HoldCategory, number[]>();
    closed.forEach((e) => {
      const arr = byCategory.get(e.category) ?? [];
      arr.push(hoursBetween(e.lockedAt, e.resolvedAt as string));
      byCategory.set(e.category, arr);
    });
    let bottleneck: { category: HoldCategory; avg: number } | null = null;
    byCategory.forEach((arr, cat) => {
      const catAvg = arr.reduce((a, b) => a + b, 0) / arr.length;
      if (!bottleneck || catAvg > bottleneck.avg) {
        bottleneck = { category: cat, avg: catAvg };
      }
    });

    return { avg, bottleneck, resolvedCount: closed.length };
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => {
        if (category !== 'all' && e.category !== category) return false;
        if (q) {
          const hay = [e.claimNumber, e.vin].filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          new Date(b.resolvedAt ?? b.lockedAt).getTime() -
          new Date(a.resolvedAt ?? a.lockedAt).getTime(),
      );
  }, [entries, query, category]);

  const bottleneck = analytics.bottleneck as { category: HoldCategory; avg: number } | null;

  return (
    <div className="space-y-4">
      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          label="Avg Resolution Time"
          value={formatDuration(analytics.avg)}
          sub="Hold placement → resolution"
        />
        <MetricCard
          label="Active Bottleneck Stage"
          value={bottleneck ? HOLD_CATEGORY_LABEL[bottleneck.category] : '—'}
          sub={bottleneck ? `${formatDuration(bottleneck.avg)} avg` : 'No resolved holds'}
        />
        <MetricCard
          label="Resolved Holds"
          value={String(analytics.resolvedCount)}
          sub={`${entries.length} total events`}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <span
            className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-zinc-500"
            aria-hidden
          >
            🔍
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by claim # or VIN…"
            aria-label="Search hold logs by claim number or VIN"
            className="w-full rounded-md border border-zinc-700 bg-zinc-950/70 py-1.5 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', ...AUDIT_FILTER_CATEGORIES] as CategoryFilter[]).map((c) => {
            const active = category === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={active}
                className={clsx(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                    : 'border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800',
                )}
              >
                {c === 'all' ? 'All' : HOLD_CATEGORY_LABEL[c]}
              </button>
            );
          })}
          <span className="ml-1 rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
            {source === 'supabase' ? 'Live · Supabase' : 'Sample data'}
          </span>
        </div>
      </div>

      {/* Activity feed */}
      {filtered.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-600">
          No hold activity matches these filters.
        </div>
      ) : (
        <ol className="space-y-2">
          {filtered.map((e) => {
            const durationHours = e.resolvedAt ? hoursBetween(e.lockedAt, e.resolvedAt) : null;
            return (
              <li
                key={e.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-sky-300">
                      {e.claimNumber ?? 'NO CLAIM'}
                    </span>
                    <span
                      className={clsx(
                        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold',
                        CATEGORY_TONE[e.category],
                      )}
                    >
                      {HOLD_CATEGORY_LABEL[e.category]}
                    </span>
                    <span
                      className={clsx(
                        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold',
                        ACTION_TONE[e.action],
                      )}
                    >
                      {HOLD_ACTION_LABEL[e.action]}
                    </span>
                  </div>
                  <span className="text-[11px] tabular-nums text-zinc-500">
                    {new Date(e.resolvedAt ?? e.lockedAt).toLocaleString()}
                  </span>
                </div>

                {e.reason && (
                  <p className="mt-1.5 text-sm text-zinc-300">{e.reason}</p>
                )}

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                  <span>
                    Operator: <span className="text-zinc-300">{e.operator}</span>
                  </span>
                  {e.vin && (
                    <span>
                      VIN …<span className="font-mono text-zinc-400">{e.vin.slice(-8)}</span>
                    </span>
                  )}
                  <span>
                    Placed {new Date(e.lockedAt).toLocaleDateString()}
                  </span>
                  {durationHours != null && (
                    <span>
                      Held <span className="text-zinc-300">{formatDuration(durationHours)}</span>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
