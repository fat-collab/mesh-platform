'use client';

/**
 * ExecutiveDashboardView — shop-wide profit KPIs + margin-leakage alerts.
 *
 * KPI cards (Gross Profit, Avg RO Margin, Labor Efficiency, Dealer Discount
 * Leakage) and a leakage table flagging specific ROs / part lines where the
 * expected wholesale/shop discount appears to have been omitted by the supplier.
 */
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { getShopAnalyticsSummary, type ShopAnalyticsSummary } from '@/lib/analytics-db';
import { PART_TYPE_LABEL } from '@/components/ops/ro-parts-types';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money2 = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function KpiCard({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const toneCls = {
    neutral: 'text-zinc-100',
    good: 'text-emerald-300',
    warn: 'text-amber-300',
    bad: 'text-red-300',
  }[tone];
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={clsx('mt-1 text-2xl font-bold tabular-nums', toneCls)}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

export function ExecutiveDashboardView() {
  const [data, setData] = useState<ShopAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const summary = await getShopAnalyticsSummary();
        if (!cancelled) setData(summary);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Analytics load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
        Loading analytics…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-400">
        ⚠️ {error ?? 'No analytics available.'}
      </div>
    );
  }

  const { metrics, flaggedROs, repairOrderCount } = data;
  const blendedMargin = metrics.totalRevenue > 0 ? metrics.grossProfit / metrics.totalRevenue : 0;
  const leakRowCount = flaggedROs.reduce((s, ro) => s + ro.flaggedParts.length, 0);

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Gross Profit"
          value={money(metrics.grossProfit)}
          sub={`${money(metrics.totalRevenue)} revenue · ${repairOrderCount} ROs`}
          tone="good"
        />
        <KpiCard
          label="Avg RO Margin"
          value={pct(blendedMargin)}
          sub={`${money(metrics.averageROValue)} avg RO value`}
          tone={blendedMargin >= 0.35 ? 'good' : blendedMargin >= 0.2 ? 'warn' : 'bad'}
        />
        <KpiCard
          label="Labor Efficiency"
          value={metrics.shopUtilizationRate > 0 ? pct(metrics.shopUtilizationRate) : '—'}
          sub="Estimated ÷ actual hours"
          tone={
            metrics.shopUtilizationRate >= 1
              ? 'good'
              : metrics.shopUtilizationRate >= 0.85
                ? 'warn'
                : 'bad'
          }
        />
        <KpiCard
          label="Dealer Discount Leakage"
          value={money(metrics.totalDiscountLeakage)}
          sub={`${leakRowCount} line(s) across ${flaggedROs.length} RO(s)`}
          tone={metrics.totalDiscountLeakage > 0 ? 'bad' : 'good'}
        />
      </div>

      {/* Margin leakage alert table */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-zinc-200">
          Margin Leakage Alerts
          <span className="ml-2 text-xs font-normal text-zinc-500">
            expected wholesale/shop discounts omitted by supplier
          </span>
        </h3>

        {flaggedROs.length === 0 ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-300">
            ✓ No discount leakage detected — all part lines within baseline.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-900/80 text-[11px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Repair Order</th>
                  <th className="px-3 py-2 font-medium">Part Line</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 text-right font-medium">Billed</th>
                  <th className="px-3 py-2 text-right font-medium">Discount Leaked</th>
                  <th className="px-3 py-2 text-right font-medium">RO Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {flaggedROs.flatMap((ro) =>
                  ro.flaggedParts.map((p, i) => (
                    <tr key={`${ro.repairOrderId}-${i}`} className="hover:bg-zinc-900/40">
                      <td className="px-3 py-2">
                        {i === 0 ? (
                          <div>
                            <p className="font-mono text-xs text-sky-300">
                              {ro.claimNumber ?? 'NO CLAIM'}
                            </p>
                            <p className="truncate text-[11px] text-zinc-500">
                              {ro.customerName ?? '—'} · {ro.vehicle}
                            </p>
                          </div>
                        ) : (
                          <span className="text-zinc-700">↳</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-zinc-200">{p.partName}</td>
                      <td className="px-3 py-2">
                        <span className="rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300">
                          {PART_TYPE_LABEL[p.partType]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-300">
                        {money2(p.billed)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-red-300">
                        {money2(p.expectedDiscount)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
                        {i === 0 ? pct(ro.netMargin) : ''}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
              <tfoot className="bg-zinc-900/80 text-xs">
                <tr>
                  <td className="px-3 py-2 font-semibold text-zinc-300" colSpan={4}>
                    Total dealer discount leakage
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-red-300">
                    {money2(metrics.totalDiscountLeakage)}
                  </td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
