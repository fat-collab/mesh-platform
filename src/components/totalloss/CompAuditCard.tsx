'use client';

/**
 * CompAuditCard — Stage 4 total-loss comp audit calculator.
 *
 * Upload a carrier valuation report / comp sheet; the vision service OCRs the
 * determined ACV and comparable vehicles, which populate this calculator. It
 * averages the adjusted comp prices and highlights any lowball variance where
 * the carrier's ACV sits below the comparable average.
 */
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';

interface Comp {
  vin: string;
  makeModel: string;
  mileage: number;
  distance: string;
  adjustedPrice: number;
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function CompAuditCard() {
  const [valuation, setValuation] = useState('');
  const [comps, setComps] = useState<Comp[]>([]);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setMsg('Reading comp sheet…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('docType', 'TOTAL_LOSS_COMP_SHEET');
      const res = await fetch('/api/v1/vision/ocr', { method: 'POST', body: fd });
      const json = (await res.json()) as {
        success?: boolean;
        data?: Record<string, unknown>;
        provider?: string;
      };
      if (!json.success || !json.data) {
        setMsg('Could not read comp sheet — enter manually.');
        return;
      }
      const d = json.data;
      const val = typeof d.vehicleValuation === 'number' ? d.vehicleValuation : 0;
      const rawComps = Array.isArray(d.comps) ? d.comps : [];
      const parsed: Comp[] = rawComps.map((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        return {
          vin: typeof o.vin === 'string' ? o.vin : '',
          makeModel: typeof o.makeModel === 'string' ? o.makeModel : '',
          mileage: typeof o.mileage === 'number' ? o.mileage : 0,
          distance: typeof o.distance === 'string' ? o.distance : '',
          adjustedPrice: typeof o.adjustedPrice === 'number' ? o.adjustedPrice : 0,
        };
      });
      if (val) setValuation(String(val));
      setComps(parsed);
      setMsg(`Loaded ${parsed.length} comps${json.provider === 'mock' ? ' (sample)' : ''}.`);
    } catch {
      setMsg('Upload failed — try again.');
    } finally {
      setUploading(false);
    }
  };

  const audit = useMemo(() => {
    const priced = comps.filter((c) => c.adjustedPrice > 0);
    const avg = priced.length
      ? priced.reduce((s, c) => s + c.adjustedPrice, 0) / priced.length
      : 0;
    const val = parseFloat(valuation) || 0;
    const variance = avg && val ? avg - val : 0;
    const variancePct = avg && val ? (variance / avg) * 100 : 0;
    return { avg, val, variance, variancePct, lowball: variance > 0 };
  }, [comps, valuation]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-100">Carrier Comp Audit</h2>
        <label className="cursor-pointer rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500">
          {uploading ? 'Reading…' : '📄 Upload Carrier Comp Sheet'}
          <input
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </label>
      </div>
      {msg && <p className="mb-2 text-[11px] text-zinc-400">{msg}</p>}

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-400">Carrier ACV valuation</span>
        <div className="flex items-center rounded-md border border-zinc-700 bg-zinc-950 focus-within:border-sky-500">
          <span className="pl-3 text-xs text-zinc-500">$</span>
          <input
            type="number"
            min={0}
            value={valuation}
            onChange={(e) => setValuation(e.target.value)}
            placeholder="0"
            className="w-full bg-transparent px-2 py-2 text-sm tabular-nums text-zinc-100 focus:outline-none"
          />
        </div>
      </label>

      {comps.length > 0 ? (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="py-1 pr-2">Comparable</th>
                  <th className="py-1 pr-2">Miles</th>
                  <th className="py-1 pr-2">Dist</th>
                  <th className="py-1 text-right">Adj $</th>
                </tr>
              </thead>
              <tbody>
                {comps.map((c, i) => (
                  <tr key={i} className="border-t border-zinc-800">
                    <td className="py-1 pr-2 text-zinc-300">
                      <span className="block">{c.makeModel || '—'}</span>
                      <span className="font-mono text-[10px] text-zinc-600">{c.vin || '—'}</span>
                    </td>
                    <td className="py-1 pr-2 tabular-nums text-zinc-400">
                      {c.mileage ? c.mileage.toLocaleString() : '—'}
                    </td>
                    <td className="py-1 pr-2 text-zinc-400">{c.distance || '—'}</td>
                    <td className="py-1 text-right font-medium tabular-nums text-zinc-200">
                      {c.adjustedPrice ? money(c.adjustedPrice) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-700">
                  <td className="py-1 pr-2 font-semibold text-zinc-300" colSpan={3}>
                    Comp average
                  </td>
                  <td className="py-1 text-right font-bold tabular-nums text-zinc-100">
                    {money(audit.avg)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div
            className={clsx(
              'mt-3 rounded-lg border px-3 py-2 text-sm',
              audit.val <= 0
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                : audit.lowball
                  ? 'border-red-500/40 bg-red-500/10 text-red-200'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
            )}
          >
            {audit.val <= 0 ? (
              'Enter the carrier valuation to compute variance.'
            ) : audit.lowball ? (
              <>
                ⚠ Lowball variance: carrier ACV is{' '}
                <span className="font-semibold">{money(audit.variance)}</span> (
                {audit.variancePct.toFixed(1)}%) below the comp average.
              </>
            ) : (
              <>Carrier ACV is at or above the comp average ({money(-audit.variance)} over).</>
            )}
          </div>
        </>
      ) : (
        <p className="mt-3 text-xs text-zinc-500">
          Upload the carrier&apos;s valuation report to audit its comparables against the
          determined ACV.
        </p>
      )}
    </div>
  );
}
