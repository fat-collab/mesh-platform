'use client';

/**
 * ROStageGateGuard — intercepts RO workflow-status changes, running the
 * automated gate rules before allowing a transition. On a blocked transition it
 * surfaces the exact reason + failing rule and does not propagate the change.
 */
import { useState } from 'react';
import { clsx } from 'clsx';
import { validateStageTransition } from '@/lib/workflow-rules';
import {
  RO_STATUS_LABEL,
  RO_STATUS_ORDER,
  type ROStatus,
} from '@/components/ops/workflow-rules-types';

export interface ROStageGateGuardProps {
  repairOrderId: string;
  status: ROStatus;
  onStatusChange: (next: ROStatus) => void;
}

export function ROStageGateGuard({
  repairOrderId,
  status,
  onStatusChange,
}: ROStageGateGuardProps) {
  const [checking, setChecking] = useState(false);
  const [blocker, setBlocker] = useState<{ reason: string; rule?: string } | null>(null);

  const attempt = async (next: ROStatus) => {
    if (next === status || checking) return;
    setChecking(true);
    setBlocker(null);
    try {
      const result = await validateStageTransition(repairOrderId, next);
      if (result.allowed) {
        onStatusChange(next);
      } else {
        setBlocker({ reason: result.reason ?? 'Transition blocked.', rule: result.blockingRule });
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Workflow Status
      </h3>
      <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <select
          value={status}
          disabled={checking}
          onChange={(e) => void attempt(e.target.value as ROStatus)}
          aria-label="Workflow status"
          className="w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1.5 text-xs font-semibold text-zinc-100 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40 disabled:opacity-60"
        >
          {RO_STATUS_ORDER.map((s) => (
            <option key={s} value={s} className="bg-zinc-900">
              {RO_STATUS_LABEL[s]}
            </option>
          ))}
        </select>

        {checking && <p className="text-[11px] text-zinc-500">Checking gate rules…</p>}

        {blocker && (
          <div
            className={clsx(
              'rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-200',
            )}
            role="alert"
          >
            <p className="font-semibold">⛔ Transition blocked</p>
            <p className="mt-0.5">{blocker.reason}</p>
            {blocker.rule && (
              <p className="mt-0.5 font-mono text-[10px] text-red-300/70">rule: {blocker.rule}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
