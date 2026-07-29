'use client';

/**
 * RebuttalCard — interactive ACV vs. PDR total-loss rebuttal.
 *
 * Editable ACV / conventional / PDR / threshold inputs feed the live math in
 * `src/lib/totalloss.ts`, rendering a side-by-side comparison, a risk-score
 * indicator, the conventional delta, and a downloadable rebuttal letter.
 */
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  generateRebuttalComparison,
  type RebuttalComparison,
  type RebuttalRecommendation,
} from '@/lib/totalloss';
import { riskTone, type RiskTone } from '@/lib/board';

export interface RebuttalCardProps {
  claimNumber?: string | null;
  vehicle?: string | null;
  customerName?: string | null;
  initialAcv?: number;
  initialConventional?: number;
  initialPdr?: number;
  initialThresholdPct?: number;
  /** Optional PDR feasibility (0–1) from the vision engine, shown as context. */
  pdrFeasibilityScore?: number | null;
}

const RISK_TONE_CLASS: Record<RiskTone, string> = {
  low: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  high: 'border-red-500/40 bg-red-500/10 text-red-300',
};

const RISK_LABEL: Record<RiskTone, string> = {
  low: 'Low risk',
  medium: 'Elevated',
  high: 'Total-loss territory',
};

const RECOMMENDATION: Record<
  RebuttalRecommendation,
  { label: string; className: string }
> = {
  PDR_REPAIR: {
    label: 'Repairable via PDR — rebut the total loss',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  },
  REVIEW: {
    label: 'Neither estimate crosses the threshold — standard review',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  LIKELY_TOTAL_LOSS: {
    label: 'PDR also exceeds threshold — total loss likely legitimate',
    className: 'border-red-500/40 bg-red-500/10 text-red-300',
  },
};

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

function buildLetter(
  c: RebuttalComparison,
  ctx: { claimNumber?: string | null; vehicle?: string | null; customerName?: string | null },
): string {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const lines = [
    'MESH COLLISION — TOTAL LOSS REBUTTAL',
    `Date: ${today}`,
    `Claim Number: ${ctx.claimNumber ?? 'N/A'}`,
    `Vehicle: ${ctx.vehicle ?? 'N/A'}`,
    `Insured: ${ctx.customerName ?? 'N/A'}`,
    '',
    'To the assigned claims adjuster,',
    '',
    `We respectfully rebut the total-loss determination on the above claim. Per the applicable state total-loss threshold of ${c.thresholdPct}% of Actual Cash Value (ACV ${fmtMoney(c.acv)}), a repair is deemed a total loss only when its cost meets or exceeds ${fmtMoney(c.thresholdAmount)}.`,
    '',
    `Conventional cut/replace estimate: ${fmtMoney(c.conventional.estimate)} (${c.conventional.pctOfAcv}% of ACV, risk score ${c.conventional.riskScore}).`,
    `Paintless Dent Repair (PDR) estimate: ${fmtMoney(c.pdr.estimate)} (${c.pdr.pctOfAcv}% of ACV, risk score ${c.pdr.riskScore}).`,
    '',
    `Repairing the vehicle via PDR costs ${fmtMoney(c.savings)} less than the conventional method — a ${c.savingsPct}% reduction — and keeps the repair ${
      c.pdr.crossesThreshold ? 'near' : 'well below'
    } the total-loss threshold.`,
    '',
    c.recommendation === 'PDR_REPAIR'
      ? 'Because the PDR estimate falls below the total-loss threshold while the conventional estimate exceeds it, we request authorization to proceed with PDR and reverse the total-loss designation.'
      : c.recommendation === 'REVIEW'
        ? 'Neither estimate crosses the total-loss threshold; we request the claim be processed as a repair.'
        : 'We acknowledge the damage severity and remain available to discuss disposition.',
    '',
    'Respectfully,',
    'MESH Collision Operations',
  ];
  return lines.join('\n');
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  suffix?: string;
}

function NumberField({ label, value, onChange, step = 100, suffix }: NumberFieldProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-400">{label}</span>
      <div className="flex items-center rounded-md border border-zinc-700 bg-zinc-950 focus-within:border-sky-500">
        <input
          type="number"
          min={0}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full bg-transparent px-3 py-2 text-sm tabular-nums text-zinc-100 focus:outline-none"
        />
        {suffix && <span className="pr-3 text-xs text-zinc-500">{suffix}</span>}
      </div>
    </label>
  );
}

function LineColumn({
  title,
  line,
}: {
  title: string;
  line: RebuttalComparison['pdr'];
}) {
  const tone = riskTone(line.riskScore);
  return (
    <div className="flex-1 rounded-lg border border-zinc-700/70 bg-zinc-800/50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-zinc-100">
        {fmtMoney(line.estimate)}
      </p>
      <p className="text-xs text-zinc-500">{line.pctOfAcv}% of ACV</p>
      <div
        className={clsx(
          'mt-2 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
          RISK_TONE_CLASS[tone],
        )}
      >
        risk {line.riskScore.toFixed(2)}
        {line.crossesThreshold && <span className="ml-1">· over</span>}
      </div>
    </div>
  );
}

export function RebuttalCard({
  claimNumber,
  vehicle,
  customerName,
  initialAcv = 18000,
  initialConventional = 15500,
  initialPdr = 4200,
  initialThresholdPct = 75,
  pdrFeasibilityScore = null,
}: RebuttalCardProps) {
  const [acv, setAcv] = useState(initialAcv);
  const [conventional, setConventional] = useState(initialConventional);
  const [pdr, setPdr] = useState(initialPdr);
  const [threshold, setThreshold] = useState(initialThresholdPct);

  const comparison = useMemo<RebuttalComparison | null>(() => {
    if (!(acv > 0) || !(threshold > 0) || conventional < 0 || pdr < 0) return null;
    try {
      return generateRebuttalComparison(pdr, conventional, acv, threshold);
    } catch {
      return null;
    }
  }, [acv, conventional, pdr, threshold]);

  function handleDownload() {
    if (!comparison) return;
    const text = buildLetter(comparison, { claimNumber, vehicle, customerName });
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rebuttal-${claimNumber ?? 'draft'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">Total Loss Rebuttal</h2>
          <p className="text-xs text-zinc-500">
            {claimNumber ?? 'New draft'}
            {vehicle ? ` · ${vehicle}` : ''}
          </p>
        </div>
        {pdrFeasibilityScore != null && (
          <span
            className={clsx(
              'rounded-md border px-2 py-1 text-xs font-medium',
              pdrFeasibilityScore >= 0.5
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
            )}
            title="PDR feasibility from the vision engine"
          >
            PDR feasibility {Math.round(pdrFeasibilityScore * 100)}%
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumberField label="ACV" value={acv} onChange={setAcv} suffix="$" />
        <NumberField
          label="Conventional"
          value={conventional}
          onChange={setConventional}
          suffix="$"
        />
        <NumberField label="PDR estimate" value={pdr} onChange={setPdr} suffix="$" />
        <NumberField
          label="Threshold"
          value={threshold}
          onChange={setThreshold}
          step={1}
          suffix="%"
        />
      </div>

      {comparison ? (
        <>
          <p className="mt-4 text-xs text-zinc-500">
            Total-loss line: <span className="text-zinc-300">{fmtMoney(comparison.thresholdAmount)}</span>{' '}
            ({comparison.thresholdPct}% of ACV)
          </p>

          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <LineColumn title="PDR" line={comparison.pdr} />
            <LineColumn title="Conventional" line={comparison.conventional} />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-700/70 bg-zinc-800/40 px-3 py-2">
            <span className="text-sm text-zinc-300">
              PDR saves{' '}
              <span className="font-semibold text-emerald-300 tabular-nums">
                {fmtMoney(comparison.savings)}
              </span>{' '}
              <span className="text-zinc-500">({comparison.savingsPct}%)</span>
            </span>
            <span
              className={clsx(
                'rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide',
                RISK_TONE_CLASS[riskTone(comparison.conventional.riskScore)],
              )}
            >
              {RISK_LABEL[riskTone(comparison.conventional.riskScore)]}
            </span>
          </div>

          <div
            className={clsx(
              'mt-3 rounded-lg border px-3 py-2 text-sm font-medium',
              RECOMMENDATION[comparison.recommendation].className,
            )}
          >
            {RECOMMENDATION[comparison.recommendation].label}
          </div>

          <button
            type="button"
            onClick={handleDownload}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
          >
            Download rebuttal letter
          </button>
        </>
      ) : (
        <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Enter a positive ACV and threshold to compute the rebuttal.
        </p>
      )}
    </div>
  );
}
