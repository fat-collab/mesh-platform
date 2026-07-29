'use client';

/**
 * OpsTimelineDispatch — unified RO ops event feed + AI dispatch trigger, with a
 * risk-colored Insurance "No-Stall" stall badge. Mirrors the supplements
 * timeline pattern: reads /api/v1/ops/timeline and fires AI dispatch follow-ups.
 */
import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';

export type StallStatus =
  | 'ACTIVE'
  | 'PENDING_NUDGE'
  | 'MANAGER_ESCALATED'
  | 'SUPERVISOR_ESCALATED';

interface OpsTimelineEvent {
  id: string;
  repair_order_id: string | null;
  event_type: string;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const STALL_META: Record<StallStatus, { label: string; tone: string }> = {
  ACTIVE: { label: 'On cadence', tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  PENDING_NUDGE: { label: 'Nudge due', tone: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  MANAGER_ESCALATED: {
    label: 'Manager escalation',
    tone: 'border-orange-500/50 bg-orange-500/10 text-orange-300',
  },
  SUPERVISOR_ESCALATED: {
    label: 'Supervisor escalation',
    tone: 'border-red-500/50 bg-red-500/10 text-red-300',
  },
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export interface OpsTimelineDispatchProps {
  repairOrderId: string;
  /** Insurance No-Stall status for the risk badge (from cadence tracking). */
  stallStatus?: StallStatus;
}

export function OpsTimelineDispatch({ repairOrderId, stallStatus = 'ACTIVE' }: OpsTimelineDispatchProps) {
  const [events, setEvents] = useState<OpsTimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/ops/timeline?repairOrderId=${encodeURIComponent(repairOrderId)}`);
    const json = (await res.json()) as { success?: boolean; events?: OpsTimelineEvent[] };
    setEvents(json.events ?? []);
  }, [repairOrderId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    // Lightweight live refresh: re-pull when the tab regains focus.
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const handleDispatch = async () => {
    if (dispatching) return;
    setDispatching(true);
    setNotice(null);
    try {
      const res = await fetch('/api/v1/ops/timeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repairOrderId,
          eventType: 'AI_DISPATCH',
          description: 'AI dispatch queued — automated adjuster/vendor follow-up.',
          dispatch: true,
          metadata: { channel: 'email', target: 'adjuster' },
        }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error || 'Dispatch failed.');
      setNotice('AI follow-up dispatched.');
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Dispatch failed.');
    } finally {
      setDispatching(false);
    }
  };

  const stall = STALL_META[stallStatus];

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Ops Timeline &amp; Dispatch
        </h3>
        <span
          className={clsx(
            'rounded-md border px-1.5 py-0.5 text-[10px] font-semibold',
            stall.tone,
          )}
          title="Insurance No-Stall status"
        >
          {stall.label}
        </span>
      </div>

      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <button
          type="button"
          onClick={() => void handleDispatch()}
          disabled={dispatching}
          className="w-full rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
        >
          {dispatching ? 'Dispatching…' : '⚡ Fire AI Dispatch (adjuster follow-up)'}
        </button>

        {notice && <p className="text-[11px] text-zinc-400">{notice}</p>}

        {loading ? (
          <p className="text-xs text-zinc-500">Loading timeline…</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-zinc-500">No timeline events yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {events.map((e) => {
              const dispatched = e.event_type === 'AI_DISPATCH';
              return (
                <li
                  key={e.id}
                  className={clsx(
                    'rounded-md border px-2 py-1.5',
                    dispatched
                      ? 'border-sky-500/30 bg-sky-500/[0.05]'
                      : 'border-zinc-800 bg-zinc-900/60',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300">
                      {e.event_type}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                      {fmt(e.created_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-200">{e.description}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
