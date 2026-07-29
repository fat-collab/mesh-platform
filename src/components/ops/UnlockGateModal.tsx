'use client';

/**
 * UnlockGateModal — the Hold Gate Resolution dialog.
 *
 * Rendered when `order` is non-null (triggered from a locked ROCard's "Unlock
 * gate" action or from inside RODetailModal). Shows the current hold gate, lets
 * the operator pick a resolution reason (or write a custom note), and confirms
 * the release. Closes on Escape or backdrop click.
 */
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { GATE_TYPE_LABEL, gateTypeForStage, type BoardOrder } from '@/lib/board';

/** Preset resolution reasons, plus a free-text "Custom Note" option. */
const PRESET_REASONS = [
  'Carrier Confirmed',
  'Parts Arrived',
  'Customer Approved',
] as const;
const CUSTOM_REASON = 'Custom Note';

export interface UnlockGateModalProps {
  order: BoardOrder | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (order: BoardOrder, reason: string) => void;
}

export function UnlockGateModal({
  order,
  busy = false,
  onCancel,
  onConfirm,
}: UnlockGateModalProps) {
  const [selected, setSelected] = useState<string>(PRESET_REASONS[0]);
  const [customNote, setCustomNote] = useState('');

  // Reset the reason each time the dialog opens for a different order.
  useEffect(() => {
    if (order) {
      setSelected(PRESET_REASONS[0]);
      setCustomNote('');
    }
  }, [order?.id]);

  useEffect(() => {
    if (!order) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [order, busy, onCancel]);

  if (!order) return null;

  const gateType = gateTypeForStage(order.stage);
  const isTotalLoss = gateType === 'TOTAL_LOSS_REBUTTAL';
  const isCustom = selected === CUSTOM_REASON;
  const resolvedReason = isCustom ? customNote.trim() : selected;
  const canSubmit = !busy && resolvedReason.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-gate-title"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="unlock-gate-title" className="text-lg font-semibold text-zinc-100">
          Resolve hold gate
        </h2>

        <div className="mt-3 space-y-1.5 text-sm text-zinc-300">
          <p>
            You are releasing the{' '}
            <span
              className={clsx(
                'font-semibold',
                isTotalLoss ? 'text-red-300' : 'text-amber-300',
              )}
            >
              {gateType ? GATE_TYPE_LABEL[gateType] : 'hold'}
            </span>{' '}
            gate on:
          </p>
          <div className="rounded-lg border border-zinc-700/70 bg-zinc-800/60 px-3 py-2">
            <p className="font-mono text-xs text-sky-300">
              {order.claim_number ?? 'NO CLAIM'}
            </p>
            <p className="text-sm font-medium text-zinc-100">{order.vehicle}</p>
            <p className="text-xs text-zinc-400">
              {order.customer_name ?? 'Unknown customer'}
            </p>
          </div>
        </div>

        {/* Resolution reason selector */}
        <fieldset className="mt-4">
          <legend className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
            Resolution reason
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {[...PRESET_REASONS, CUSTOM_REASON].map((reason) => {
              const active = selected === reason;
              return (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setSelected(reason)}
                  disabled={busy}
                  aria-pressed={active}
                  className={clsx(
                    'rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors disabled:opacity-50',
                    active
                      ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                      : 'border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800',
                  )}
                >
                  {reason}
                </button>
              );
            })}
          </div>

          {isCustom && (
            <textarea
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              disabled={busy}
              autoFocus
              rows={3}
              placeholder="Describe how this gate was resolved…"
              className="mt-2 w-full resize-none rounded-md border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
            />
          )}
        </fieldset>

        <p className="mt-3 text-xs text-zinc-500">
          Once resolved, this repair order can be dragged out of its hold column.
          The reason and timestamp are recorded to the gate&apos;s audit history.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => canSubmit && onConfirm(order, resolvedReason)}
            disabled={!canSubmit}
            className={clsx(
              'rounded-md px-3 py-1.5 text-sm font-semibold text-white transition-colors disabled:opacity-50',
              isTotalLoss
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-amber-600 hover:bg-amber-500',
            )}
          >
            {busy ? 'Resolving…' : 'Resolve gate'}
          </button>
        </div>
      </div>
    </div>
  );
}
