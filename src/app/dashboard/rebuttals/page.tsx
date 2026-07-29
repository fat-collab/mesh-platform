'use client';

/**
 * Rebuttals — Adjuster Accountability & Rebuttal Hub.
 *
 * Fast reference of carrier tactics vs. regulatory counter-punches with search,
 * category filter pills, and one-click copy of ready-to-send notice snippets.
 */
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  REBUTTALS,
  REBUTTAL_CATEGORIES,
  REBUTTAL_CATEGORY_LABEL,
  type RebuttalCategory,
} from '@/lib/rebuttals-data';
import { RebuttalCard } from '@/components/totalloss/RebuttalCard';
import { CompAuditCard } from '@/components/totalloss/CompAuditCard';

type Filter = RebuttalCategory | 'ALL';

const COMP_AUDIT_STEPS = [
  'Pulled every comparable VIN + source listing from the valuation report',
  'Confirmed comps are within the local market radius',
  'Mileage adjustment applied & documented per comp (loss vehicle miles)',
  'Options / trim / drivetrain parity confirmed and added back',
  'Condition deductions itemized and justified',
  'Prior-damage / branded-title status verified on comps',
  'Appraisal Clause invoked if ACV remains disputed',
];

const CATEGORY_TONE: Record<RebuttalCategory, string> = {
  PROMPT_PAYMENT: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  TOTAL_LOSS: 'border-red-500/40 bg-red-500/15 text-red-200',
  PDR_MATRIX: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  OEM_SAFETY: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
};

export default function RebuttalsPage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [audit, setAudit] = useState<Record<number, boolean>>({});

  const auditDone = Object.values(audit).filter(Boolean).length;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return REBUTTALS.filter((r) => {
      if (filter !== 'ALL' && r.category !== filter) return false;
      if (q) {
        const hay = [
          r.title,
          r.carrierExcuse,
          r.tacticalCounterPunch,
          r.statutoryCitation,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [query, filter]);

  const copy = async (id: string, snippet: string) => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-[1100px] px-6 py-6">
        <header className="mb-5">
          <h1 className="text-xl font-bold tracking-tight">Adjuster Accountability &amp; Rebuttals</h1>
          <p className="text-sm text-zinc-400">
            Carrier tactics, regulatory counter-punches, and ready-to-send notices ·{' '}
            {REBUTTALS.length} plays
          </p>
        </header>

        {/* Search + filter pills */}
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 lg:flex-row lg:items-center lg:justify-between">
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
              placeholder="Search tactic, statute, or keyword…"
              aria-label="Search rebuttals"
              className="w-full rounded-md border border-zinc-700 bg-zinc-950/70 py-1.5 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(['ALL', ...REBUTTAL_CATEGORIES] as Filter[]).map((c) => {
              const active = filter === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFilter(c)}
                  aria-pressed={active}
                  className={clsx(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                      : 'border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800',
                  )}
                >
                  {c === 'ALL' ? 'All' : REBUTTAL_CATEGORY_LABEL[c]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Interactive ACV valuation + comp audit — Total Loss tab */}
        {filter === 'TOTAL_LOSS' && (
          <div className="mb-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <RebuttalCard />
              <CompAuditCard />
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-base font-semibold text-zinc-100">Comp Audit Checklist</h2>
                <span className="text-xs tabular-nums text-zinc-400">
                  {auditDone}/{COMP_AUDIT_STEPS.length}
                </span>
              </div>
              <p className="mb-3 text-xs text-zinc-500">
                Work each step before accepting the carrier’s ACV.
              </p>
              <ul className="space-y-1.5">
                {COMP_AUDIT_STEPS.map((step, i) => (
                  <li key={i}>
                    <label className="flex items-start gap-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={Boolean(audit[i])}
                        onChange={(e) =>
                          setAudit((prev) => ({ ...prev, [i]: e.target.checked }))
                        }
                        className="mt-0.5"
                      />
                      <span className={audit[i] ? 'text-zinc-500 line-through' : ''}>{step}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Cards */}
        {results.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-600">
            No rebuttals match your search.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {results.map((r) => (
              <article
                key={r.id}
                className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900/60 p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold text-zinc-100">{r.title}</h2>
                  <span
                    className={clsx(
                      'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold',
                      CATEGORY_TONE[r.category],
                    )}
                  >
                    {REBUTTAL_CATEGORY_LABEL[r.category]}
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="rounded-md border border-red-500/20 bg-red-500/5 p-2">
                    <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-red-300/80">
                      Carrier Tactic
                    </p>
                    <p className="text-zinc-300">{r.carrierExcuse}</p>
                  </div>
                  <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2">
                    <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300/80">
                      Regulatory Counter-Punch
                    </p>
                    <p className="text-zinc-200">{r.tacticalCounterPunch}</p>
                    <p className="mt-1 font-mono text-[11px] font-semibold text-sky-300">
                      {r.statutoryCitation}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="truncate text-[10px] italic text-zinc-600">
                    Snippet ready — verify current language before sending.
                  </p>
                  <button
                    type="button"
                    onClick={() => void copy(r.id, r.templateSnippet)}
                    className={clsx(
                      'shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                      copiedId === r.id
                        ? 'bg-emerald-600 text-white'
                        : 'bg-sky-600 text-white hover:bg-sky-500',
                    )}
                  >
                    {copiedId === r.id ? '✓ Copied' : 'Copy Notice Snippet'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
