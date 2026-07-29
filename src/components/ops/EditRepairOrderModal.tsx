'use client';

/**
 * EditRepairOrderModal — edits a repair order's core fields (customer name,
 * claim number, stage). Opened from the "Edit" affordance on a Kanban card; the
 * parent persists on save and refreshes the board. Render conditionally and key
 * by order id so the form seeds cleanly per order.
 */
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { STAGE_META, STAGE_ORDER, type BoardOrder } from '@/lib/board';
import type { RoStage } from '@/lib/database.types';

export interface EditRepairOrderPatch {
  customerName: string;
  claimNumber: string;
  stage: RoStage;
  /** ISO timestamp, or null to clear. */
  targetDeliveryDate: string | null;
}

export interface EditRepairOrderModalProps {
  order: BoardOrder;
  onClose: () => void;
  onSave: (patch: EditRepairOrderPatch) => Promise<void> | void;
}

/** ISO timestamp -> yyyy-mm-dd for a date input's value. */
function toDateInputValue(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function EditRepairOrderModal({ order, onClose, onSave }: EditRepairOrderModalProps) {
  const [customerName, setCustomerName] = useState(order.customer_name ?? '');
  const [claimNumber, setClaimNumber] = useState(order.claim_number ?? '');
  const [stage, setStage] = useState<RoStage>(order.stage);
  const [targetDeliveryDate, setTargetDeliveryDate] = useState(
    toDateInputValue(order.targetDeliveryDate),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        customerName: customerName.trim(),
        claimNumber: claimNumber.trim(),
        stage,
        targetDeliveryDate: targetDeliveryDate
          ? new Date(`${targetDeliveryDate}T00:00:00`).toISOString()
          : null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const input =
    'w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Edit repair order"
      onClick={() => !saving && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 p-4">
          <div>
            <h2 className="text-base font-bold text-zinc-100">Edit Repair Order</h2>
            <p className="text-[11px] text-zinc-500">{order.vehicle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 p-4">
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-xs text-red-200">
              {error}
            </div>
          )}

          <label className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              Customer name
            </span>
            <input
              className={input}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer name"
            />
          </label>

          <label className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              Claim #
            </span>
            <input
              className={input}
              value={claimNumber}
              onChange={(e) => setClaimNumber(e.target.value)}
              placeholder="Claim number"
            />
          </label>

          <label className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              Stage
            </span>
            <select
              className={clsx(input, 'font-medium')}
              value={stage}
              onChange={(e) => setStage(e.target.value as RoStage)}
            >
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s} className="bg-zinc-900">
                  {STAGE_META[s].label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              Target delivery date (ETA)
            </span>
            <input
              type="date"
              className={input}
              value={targetDeliveryDate}
              onChange={(e) => setTargetDeliveryDate(e.target.value)}
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
