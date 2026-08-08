'use client';

/**
 * LostReasonModal — required reason picker shown before a lead commits to
 * LOST. Lost is available from any pre-conversion status, but the reason is
 * mandatory: status and lost_reason are written together (markLeadLost), so
 * a lead can never end up LOST with no reason on file.
 */
import { useState } from 'react';
import { markLeadLost } from '@/lib/sales-db';
import { LOST_REASON_LABEL, LOST_REASON_ORDER } from '@/components/sales/types';
import type { IntakeLead, LostReason } from '@/components/sales/types';

interface LostReasonModalProps {
  lead: IntakeLead;
  onClose: () => void;
  onLost: () => void;
}

export function LostReasonModal({ lead, onClose, onLost }: LostReasonModalProps) {
  const [reason, setReason] = useState<LostReason | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await markLeadLost(lead.id, reason);
      onLost();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark lead lost.');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Mark lead lost"
      onClick={submitting ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-xl"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-bold text-zinc-100">Mark Lost</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-zinc-500 hover:text-zinc-200 disabled:opacity-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-zinc-500">
          For {lead.customerName} — a reason is required.
        </p>

        {error && (
          <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as LostReason)}
          aria-label="Lost reason"
          disabled={submitting}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40 disabled:opacity-50"
        >
          <option value="" disabled>
            Select a reason…
          </option>
          {LOST_REASON_ORDER.map((r) => (
            <option key={r} value={r}>
              {LOST_REASON_LABEL[r]}
            </option>
          ))}
        </select>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!reason || submitting}
            className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
          >
            {submitting ? 'Marking…' : 'Mark Lost'}
          </button>
        </div>
      </div>
    </div>
  );
}
