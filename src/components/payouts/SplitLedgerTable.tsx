'use client';

/**
 * SplitLedgerTable — 50/10/40 payout breakdown (Lead Tech / Sales / House)
 * with status badges and Stripe Connect execution triggers.
 */
import { clsx } from 'clsx';
import type { PayoutSplitRole, PayoutStatus } from '@/lib/database.types';

export interface LedgerSplit {
  id: string;
  role: PayoutSplitRole;
  pct: number;
  grossAmount: number;
  netPayout: number;
  status: PayoutStatus;
  stripeTransferId: string | null;
  recipient?: string | null;
}

export interface SplitLedgerTableProps {
  /** Claim/label for the header (e.g. the repair order's claim number). */
  title?: string;
  splits: LedgerSplit[];
  busy?: boolean;
  /** Execute the given split ids (Stripe Connect transfers, server-side). */
  onExecute?: (ids: string[]) => void;
}

const ROLE_LABEL: Record<PayoutSplitRole, string> = {
  PDR_LEAD: 'Lead Tech · PDR',
  SALES: 'Sales',
  HOUSE: 'House',
};

const STATUS_TONE: Record<PayoutStatus, string> = {
  PENDING: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  PROCESSING: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  PAID: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  FAILED: 'border-red-500/40 bg-red-500/10 text-red-300',
  REVERSED: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300',
};

const EXECUTABLE: ReadonlySet<PayoutStatus> = new Set<PayoutStatus>(['PENDING', 'FAILED']);

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function SplitLedgerTable({
  title,
  splits,
  busy = false,
  onExecute,
}: SplitLedgerTableProps) {
  const gross = splits[0]?.grossAmount ?? 0;
  const totalNet = splits.reduce((s, r) => s + r.netPayout, 0);
  const pendingIds = splits.filter((s) => EXECUTABLE.has(s.status)).map((s) => s.id);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{title ?? 'Payout split'}</h3>
          <p className="text-xs text-zinc-500">Gross {fmtMoney(gross)} · 50 / 10 / 40</p>
        </div>
        {onExecute && pendingIds.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onExecute(pendingIds)}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
          >
            {busy ? 'Executing…' : `Execute all pending (${pendingIds.length})`}
          </button>
        )}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
            <th className="px-4 py-2 font-medium">Recipient</th>
            <th className="px-4 py-2 font-medium">Split</th>
            <th className="px-4 py-2 text-right font-medium">Net</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Transfer</th>
            <th className="px-4 py-2 text-right font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {splits.map((s) => (
            <tr key={s.id} className="border-t border-zinc-800/70">
              <td className="px-4 py-2.5 text-zinc-200">
                {ROLE_LABEL[s.role]}
                {s.recipient && (
                  <span className="ml-1 text-xs text-zinc-500">· {s.recipient}</span>
                )}
              </td>
              <td className="px-4 py-2.5 tabular-nums text-zinc-400">{s.pct}%</td>
              <td className="px-4 py-2.5 text-right font-medium tabular-nums text-zinc-100">
                {fmtMoney(s.netPayout)}
              </td>
              <td className="px-4 py-2.5">
                <span
                  className={clsx(
                    'inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                    STATUS_TONE[s.status],
                  )}
                >
                  {s.status}
                </span>
              </td>
              <td className="px-4 py-2.5">
                {s.stripeTransferId ? (
                  <span className="font-mono text-xs text-zinc-500">{s.stripeTransferId}</span>
                ) : (
                  <span className="text-xs text-zinc-600">—</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right">
                {onExecute && EXECUTABLE.has(s.status) ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onExecute([s.id])}
                    className="rounded-md border border-zinc-700 px-2 py-1 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-60"
                  >
                    Execute
                  </button>
                ) : (
                  <span className="text-xs text-zinc-600">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-zinc-700 bg-zinc-900/80">
            <td className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Total
            </td>
            <td />
            <td className="px-4 py-2.5 text-right font-bold tabular-nums text-zinc-100">
              {fmtMoney(totalNet)}
            </td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
