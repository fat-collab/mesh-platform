'use client';

/**
 * RODrawerInvoiceSection — invoicing & accounts-receivable panel for the RO
 * Detail Drawer.
 *
 * Rolls up a computed estimate (base + parts + approved supplements + labor)
 * into subtotal / tax / total, generates or views the RO invoice, and updates
 * payment status. Backed by invoice-db (DB-first with a session-local fallback);
 * source figures come from parts-db / supplement-db (canonical, claim-scoped) /
 * labor-db.
 */
import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { getInvoice, generateInvoice, updateInvoiceStatus } from '@/lib/invoice-db';
import { getParts } from '@/lib/parts-db';
import { getSupplementsForRO, approvedSupplementTotal } from '@/lib/supplement-db';
import { getLaborEntries } from '@/lib/labor-db';
import {
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_ORDER,
  type InvoiceStatus,
  type RepairOrderInvoice,
} from '@/components/ops/ro-invoice-types';

// Shop financial constants for the rolled-up estimate.
const BASE_FEE = 250; // shop supplies / base charge
const LABOR_RATE = 95; // $/hr
const TAX_RATE = 0.0825; // 8.25%

const STATUS_TONE: Record<InvoiceStatus, string> = {
  DRAFT: 'border-zinc-600/60 bg-zinc-700/40 text-zinc-300',
  SENT: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  PAID: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  VOID: 'border-red-500/50 bg-red-500/15 text-red-200',
};

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export interface RODrawerInvoiceSectionProps {
  repairOrderId: string;
  claimNumber: string;
}

export function RODrawerInvoiceSection({
  repairOrderId,
  claimNumber,
}: RODrawerInvoiceSectionProps) {
  const [open, setOpen] = useState(true);
  const [invoice, setInvoice] = useState<RepairOrderInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Computed roll-up.
  const [partsTotal, setPartsTotal] = useState(0);
  const [supplementsTotal, setSupplementsTotal] = useState(0);
  const [laborTotal, setLaborTotal] = useState(0);

  const load = useCallback(async () => {
    const [inv, parts, supplements, labor] = await Promise.all([
      getInvoice(repairOrderId),
      getParts(repairOrderId),
      getSupplementsForRO(repairOrderId, claimNumber),
      getLaborEntries(repairOrderId),
    ]);
    setInvoice(inv);
    setPartsTotal(parts.reduce((s, p) => s + p.cost, 0));
    setSupplementsTotal(approvedSupplementTotal(supplements));
    setLaborTotal(labor.reduce((s, e) => s + e.actualHours, 0) * LABOR_RATE);
  }, [repairOrderId, claimNumber]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const subtotal = Number((BASE_FEE + partsTotal + supplementsTotal + laborTotal).toFixed(2));
  const tax = Number((subtotal * TAX_RATE).toFixed(2));
  const total = Number((subtotal + tax).toFixed(2));

  const handleGenerate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const inv = await generateInvoice(repairOrderId, subtotal, tax);
      setInvoice(inv);
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = async (status: InvoiceStatus) => {
    if (!invoice) return;
    setInvoice({ ...invoice, status });
    await updateInvoiceStatus(invoice.id, status);
    await load();
  };

  const Line = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between text-[11px]">
      <span className="text-zinc-500">{label}</span>
      <span className="tabular-nums text-zinc-300">{value}</span>
    </div>
  );

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Invoice &amp; A/R
        </h3>
        <span className="text-zinc-500">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          {loading ? (
            <p className="text-xs text-zinc-500">Loading invoice…</p>
          ) : (
            <>
              {/* Computed roll-up */}
              <div className="space-y-1 rounded-md border border-zinc-800 bg-zinc-900/60 p-2">
                <Line label="Base / shop supplies" value={money(BASE_FEE)} />
                <Line label="Parts" value={money(partsTotal)} />
                <Line label="Approved supplements" value={money(supplementsTotal)} />
                <Line label={`Labor (${money(LABOR_RATE)}/hr)`} value={money(laborTotal)} />
                <div className="mt-1 flex justify-between border-t border-zinc-800 pt-1 text-xs">
                  <span className="text-zinc-400">Subtotal</span>
                  <span className="font-semibold tabular-nums text-zinc-200">{money(subtotal)}</span>
                </div>
                <Line label={`Tax (${(TAX_RATE * 100).toFixed(2)}%)`} value={money(tax)} />
                <div className="flex justify-between text-sm">
                  <span className="font-semibold text-zinc-100">Total</span>
                  <span className="font-semibold tabular-nums text-emerald-300">{money(total)}</span>
                </div>
              </div>

              {invoice ? (
                <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-900/60 p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-sky-300">
                      {invoice.invoiceNumber}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-emerald-300">
                      {money(invoice.total)}
                    </span>
                  </div>
                  {invoice.paidAt && (
                    <p className="text-[11px] text-emerald-300/80">
                      Paid {new Date(invoice.paidAt).toLocaleDateString()}
                    </p>
                  )}
                  <select
                    value={invoice.status}
                    onChange={(e) => void handleStatus(e.target.value as InvoiceStatus)}
                    aria-label="Invoice status"
                    className={clsx(
                      'w-full rounded-md border px-1.5 py-1 text-[11px] font-semibold focus:outline-none',
                      STATUS_TONE[invoice.status],
                    )}
                  >
                    {INVOICE_STATUS_ORDER.map((s) => (
                      <option key={s} value={s} className="bg-zinc-900 text-zinc-200">
                        {INVOICE_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleGenerate()}
                    disabled={busy}
                    className="w-full rounded-md border border-zinc-700 px-3 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {busy ? 'Regenerating…' : 'Regenerate from current totals'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={busy}
                  className="w-full rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
                >
                  {busy ? 'Generating…' : 'Generate Invoice'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
