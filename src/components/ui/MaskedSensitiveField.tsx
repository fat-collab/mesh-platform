'use client';

/**
 * MaskedSensitiveField — masks sensitive identifiers (check numbers, claim /
 * account IDs) by default, showing only the last 4 as '••••-••••-XXXX', with a
 * toggleable Reveal. Every unmask is logged (console + optional onReveal hook)
 * so reveals of protected data can be audited.
 */
import { useState } from 'react';
import { clsx } from 'clsx';

export interface MaskedSensitiveFieldProps {
  /** The full sensitive value (shown only when revealed). */
  sensitiveValue: string;
  /** Optional label shown before the value. */
  label?: string;
  /** Repair order / record context for reveal auditing. */
  repairOrderId?: string;
  /** Field identifier recorded in the audit trail (e.g. 'check_number'). */
  field?: string;
  /** Acting user id for reveal auditing. */
  userId?: string;
  /** Optional extra hook fired on unmask (the audit POST is automatic). */
  onReveal?: () => void | Promise<void>;
  className?: string;
}

function mask(value: string): string {
  const last4 = value.slice(-4);
  return last4 ? `••••-••••-${last4}` : '••••-••••';
}

export function MaskedSensitiveField({
  sensitiveValue,
  label,
  repairOrderId,
  field,
  userId,
  onReveal,
  className,
}: MaskedSensitiveFieldProps) {
  const [revealed, setRevealed] = useState(false);

  const toggle = () => {
    setRevealed((prev) => {
      const next = !prev;
      // Log only the unmask transition (masked → revealed).
      if (next) {
        const at = new Date().toISOString();
        console.info('[privacy] sensitive field revealed', { label, repairOrderId, field, userId, at });
        // Best-effort audit ping — never blocks the reveal.
        if (repairOrderId) {
          void fetch('/api/v1/audit/log-reveal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repairOrderId, field, userId }),
          }).catch(() => {
            /* swallow — reveal auditing is best-effort */
          });
        }
        void onReveal?.();
      }
      return next;
    });
  };

  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      {label && <span className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</span>}
      <span className="font-mono text-sm tabular-nums text-zinc-100">
        {revealed ? sensitiveValue : mask(sensitiveValue)}
      </span>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={revealed}
        className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
      >
        {revealed ? 'Hide' : 'Reveal'}
      </button>
    </span>
  );
}
