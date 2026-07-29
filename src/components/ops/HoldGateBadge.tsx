/**
 * HoldGateBadge — amber/red lock indicator for an active hold gate.
 * Total-loss gates render red; carrier/parts gates render amber (rule C).
 */
import { clsx } from 'clsx';
import { GATE_TYPE_LABEL } from '@/lib/board';
import type { HoldGateType } from '@/lib/database.types';

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3.25" y="7" width="9.5" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

const TONE: Record<HoldGateType, string> = {
  TOTAL_LOSS_REBUTTAL:
    'border-red-500/40 bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/30',
  CARRIER_SUPPLEMENT:
    'border-amber-500/40 bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30',
  PARTS_BACKORDER:
    'border-amber-500/40 bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30',
};

export interface HoldGateBadgeProps {
  gateType: HoldGateType;
  className?: string;
}

export function HoldGateBadge({ gateType, className }: HoldGateBadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        TONE[gateType],
        className,
      )}
      title={`Hold gate: ${GATE_TYPE_LABEL[gateType]}`}
    >
      <LockIcon className="h-3 w-3" />
      {GATE_TYPE_LABEL[gateType]}
    </span>
  );
}

export { LockIcon };
