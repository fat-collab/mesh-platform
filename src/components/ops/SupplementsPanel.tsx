'use client';

/**
 * SupplementsPanel — internal estimator scoping & supplement generator.
 *
 * Lets an estimator log teardown-discovered scope line items (category, type,
 * hours/qty, rate, mandatory justification) into a DRAFT supplement package,
 * review active packages with status badges, and generate a formatted adjuster
 * justification narrative for export. Backed by ops-db with local fallback.
 */
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { getSupplementsForClaim, saveSupplementPackage } from '@/lib/ops-db';
import type {
  ScopeCategory,
  ScopeLineItem,
  SupplementPackage,
} from './types';

const CATEGORIES: ScopeCategory[] = ['BODY', 'PAINT', 'FRAME', 'MECHANICAL', 'ADAS'];
const ITEM_TYPES: ScopeLineItem['itemType'][] = ['LABOR', 'PART', 'MISC'];

const STATUS_TONE: Record<SupplementPackage['status'], string> = {
  DRAFT: 'border-zinc-600/60 bg-zinc-700/40 text-zinc-200',
  SUBMITTED: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  APPROVED: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  DENIED: 'border-red-500/40 bg-red-500/15 text-red-200',
};

const money = (n: number) => `$${n.toFixed(2)}`;

function genId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

function buildNarrative(pkg: SupplementPackage): string {
  const lines: string[] = [];
  lines.push(`SUPPLEMENT JUSTIFICATION — ${pkg.claimNumber}`);
  lines.push(
    `Package ${pkg.id} · Status: ${pkg.status} · Created ${new Date(pkg.createdAt).toLocaleString()}`,
  );
  lines.push('='.repeat(48));
  pkg.items.forEach((it, i) => {
    const unit = it.itemType === 'LABOR' ? 'hrs' : 'x';
    lines.push(`${i + 1}. [${it.category} · ${it.itemType}] ${it.description}`);
    lines.push(
      `   ${it.hoursOrQuantity} ${unit} @ ${money(it.unitRate)} = ${money(it.total)}` +
        (it.teardownDiscovered ? '  (teardown-discovered)' : ''),
    );
    lines.push(`   Justification: ${it.justificationNotes}`);
  });
  lines.push('-'.repeat(48));
  lines.push(`TOTAL SUPPLEMENT DELTA: ${money(pkg.totalDelta)}`);
  if (pkg.adjusterNotes) lines.push(`Adjuster notes: ${pkg.adjusterNotes}`);
  return lines.join('\n');
}

export interface SupplementsPanelProps {
  claimNumber: string | null;
}

export function SupplementsPanel({ claimNumber }: SupplementsPanelProps) {
  const [packages, setPackages] = useState<SupplementPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Add-item form.
  const [category, setCategory] = useState<ScopeCategory>('BODY');
  const [itemType, setItemType] = useState<ScopeLineItem['itemType']>('LABOR');
  const [description, setDescription] = useState('');
  const [qty, setQty] = useState('');
  const [rate, setRate] = useState('');
  const [teardownDiscovered, setTeardownDiscovered] = useState(true);
  const [justification, setJustification] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Generated narrative for export.
  const [narrative, setNarrative] = useState<{ pkgId: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!claimNumber) {
      setPackages([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        setLoadError(null);
        const pkgs = await getSupplementsForClaim(claimNumber);
        if (cancelled) return;
        setPackages(pkgs);
      } catch (err: unknown) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Data sync failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claimNumber]);

  const inputClass =
    'w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40';

  const persist = (pkg: SupplementPackage) => {
    void saveSupplementPackage(pkg);
  };

  const addItem = () => {
    if (!claimNumber) return;
    const q = parseFloat(qty);
    const r = parseFloat(rate);
    if (!description.trim()) return setFormError('Description is required.');
    if (!Number.isFinite(q) || q <= 0) return setFormError('Enter hours/qty greater than 0.');
    if (!Number.isFinite(r) || r < 0) return setFormError('Enter a valid unit rate.');
    if (!justification.trim())
      return setFormError('Justification notes are required for insurance pushback.');

    const item: ScopeLineItem = {
      id: genId('sli'),
      claimNumber,
      category,
      description: description.trim(),
      itemType,
      hoursOrQuantity: q,
      unitRate: r,
      total: Math.round(q * r * 100) / 100,
      teardownDiscovered,
      justificationNotes: justification.trim(),
    };

    setPackages((prev) => {
      const draftIdx = prev.findIndex((p) => p.status === 'DRAFT');
      let next: SupplementPackage[];
      if (draftIdx >= 0) {
        const draft = prev[draftIdx];
        const items = [...draft.items, item];
        const updated: SupplementPackage = {
          ...draft,
          items,
          totalDelta: Math.round(items.reduce((s, it) => s + it.total, 0) * 100) / 100,
        };
        next = prev.map((p, i) => (i === draftIdx ? updated : p));
        persist(updated);
      } else {
        const created: SupplementPackage = {
          id: genId('sup'),
          claimNumber,
          status: 'DRAFT',
          items: [item],
          totalDelta: item.total,
          adjusterNotes: '',
          createdAt: new Date().toISOString(),
        };
        next = [...prev, created];
        persist(created);
      }
      return next;
    });

    // Reset the entry fields (keep category/type for rapid entry).
    setDescription('');
    setQty('');
    setRate('');
    setJustification('');
    setFormError(null);
  };

  const markSubmitted = (pkg: SupplementPackage) => {
    const updated: SupplementPackage = { ...pkg, status: 'SUBMITTED' };
    setPackages((prev) => prev.map((p) => (p.id === pkg.id ? updated : p)));
    persist(updated);
  };

  const generate = (pkg: SupplementPackage) => {
    setNarrative({ pkgId: pkg.id, text: buildNarrative(pkg) });
    setCopied(false);
  };

  const copyNarrative = async () => {
    if (!narrative) return;
    try {
      await navigator.clipboard.writeText(narrative.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (!claimNumber) {
    return (
      <p className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-500">
        A claim number is required to scope supplements.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-3">
      {/* Add teardown-discovered item */}
      <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
          Add teardown-discovered item
        </p>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ScopeCategory)}
            aria-label="Scope category"
            className={inputClass}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c} className="bg-zinc-900">
                {c}
              </option>
            ))}
          </select>
          <select
            value={itemType}
            onChange={(e) => setItemType(e.target.value as ScopeLineItem['itemType'])}
            aria-label="Item type"
            className={inputClass}
          >
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t} className="bg-zinc-900">
                {t}
              </option>
            ))}
          </select>
        </div>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (e.g. Hidden inner rail damage — R&I + repair)"
          className={inputClass}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="decimal"
            placeholder={itemType === 'LABOR' ? 'Hours' : 'Quantity'}
            className={inputClass}
          />
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputMode="decimal"
            placeholder="Unit rate ($)"
            className={inputClass}
          />
        </div>
        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
          <input
            type="checkbox"
            checked={teardownDiscovered}
            onChange={(e) => setTeardownDiscovered(e.target.checked)}
          />
          Teardown-discovered (not on original estimate)
        </label>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          rows={2}
          placeholder="Justification notes (required — for insurance pushback)"
          className={clsx(inputClass, 'resize-none')}
        />
        {formError && <p className="text-[11px] text-red-300">{formError}</p>}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={addItem}
            className="rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500"
          >
            Add Scope Item
          </button>
        </div>
      </div>

      {/* Supplement packages */}
      {loadError ? (
        <div className="rounded-md border border-red-500/30 bg-red-950/20 p-2 text-xs text-red-400">
          ⚠️ Error loading supplements: {loadError}
        </div>
      ) : loading ? (
        <p className="text-xs text-zinc-500">Loading supplements…</p>
      ) : packages.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-800 p-3 text-xs text-zinc-600">
          No supplements yet. Add a teardown-discovered item to start a draft.
        </p>
      ) : (
        <ul className="space-y-2">
          {packages.map((pkg) => (
            <li key={pkg.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={clsx(
                    'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold',
                    STATUS_TONE[pkg.status],
                  )}
                >
                  {pkg.status}
                </span>
                <span className="text-xs font-semibold tabular-nums text-zinc-200">
                  Δ {money(pkg.totalDelta)}
                </span>
              </div>

              <ul className="mt-2 space-y-1.5">
                {pkg.items.map((it) => (
                  <li key={it.id} className="text-[11px] text-zinc-300">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        <span className="text-zinc-500">[{it.category}·{it.itemType}]</span>{' '}
                        {it.description}
                        {it.teardownDiscovered && (
                          <span className="ml-1 text-amber-300">•TD</span>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums text-zinc-400">
                        {it.hoursOrQuantity}
                        {it.itemType === 'LABOR' ? 'h' : 'x'} @ {money(it.unitRate)} ={' '}
                        {money(it.total)}
                      </span>
                    </div>
                    {it.justificationNotes && (
                      <p className="mt-0.5 text-zinc-500">↳ {it.justificationNotes}</p>
                    )}
                  </li>
                ))}
              </ul>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => generate(pkg)}
                  className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/20"
                >
                  Generate Adjuster Justification Package
                </button>
                {pkg.status === 'DRAFT' && (
                  <button
                    type="button"
                    onClick={() => markSubmitted(pkg)}
                    className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800"
                  >
                    Mark Submitted
                  </button>
                )}
              </div>

              {narrative?.pkgId === pkg.id && (
                <div className="mt-2 space-y-1.5">
                  <textarea
                    readOnly
                    value={narrative.text}
                    rows={8}
                    className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-950/80 p-2 font-mono text-[10px] leading-relaxed text-zinc-200"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={copyNarrative}
                      className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-300 hover:border-sky-500/50 hover:text-sky-200"
                    >
                      {copied ? '✓ Copied' : 'Copy narrative'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
