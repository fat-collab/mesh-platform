'use client';

/**
 * DispatchButton — Ops/Shop Manager-only mobile dispatch control.
 *
 * Ops Workflow Realignment: field deployment (routing a lead to a mobile
 * house call and running its DISPATCHED → EN_ROUTE → ON_SITE → COMPLETED
 * lifecycle) used to be a Sales-rep action on RoutingActionPanel. That
 * control moved here — self-gated to MANAGER/EXECUTIVE (this app's
 * "Ops/Shop Manager" roles, matching FleetRentalTracker's OVERRIDE_ROLES
 * convention) and backed by the dispatch.ts Server Action — so Sales reps
 * no longer see or trigger it at all; renders null for anyone else.
 */
import { useEffect, useState } from 'react';
import { getCurrentProfile } from '@/lib/auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { dispatchLead, updateDispatchStatus } from '@/lib/sales-db';
import {
  DISPATCH_STATUS_LABEL,
  DISPATCH_STATUS_ORDER,
  type DispatchStatus,
  type IntakeLead,
} from '@/components/sales/types';

const OPS_ROLES = new Set(['MANAGER', 'EXECUTIVE']);

interface DispatchButtonProps {
  lead: IntakeLead;
  onUpdated: () => void;
}

export function DispatchButton({ lead, onUpdated }: DispatchButtonProps) {
  const [canDispatch, setCanDispatch] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getCurrentProfile(getSupabaseBrowserClient());
        if (!cancelled) setCanDispatch(!!profile?.role && OPS_ROLES.has(profile.role));
      } catch {
        /* no session — stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const confirmDispatch = async () => {
    if (!agentName.trim()) {
      setError('Enter the field agent to dispatch.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await dispatchLead(lead.id, agentName);
      setDispatching(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dispatch field agent.');
    } finally {
      setBusy(false);
    }
  };

  const advance = async (status: DispatchStatus) => {
    setBusy(true);
    try {
      await updateDispatchStatus(lead.id, status);
      onUpdated();
    } finally {
      setBusy(false);
    }
  };

  if (!canDispatch) return null;

  // Already routed to shop drop-off — nothing for dispatch to do here.
  if (lead.routingPath === 'SHOP_DROPOFF') return null;

  if (lead.routingPath === 'MOBILE_HOUSE_CALL') {
    const status = lead.dispatchStatus ?? 'DISPATCHED';
    return (
      <div className="mt-2 space-y-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1.5">
        <p className="truncate text-[11px] font-medium text-sky-200">
          🧭 Mobile House Call · {lead.dispatchStaffName ?? 'Unassigned'}
        </p>
        <select
          value={status}
          disabled={busy}
          onChange={(e) => void advance(e.target.value as DispatchStatus)}
          aria-label={`Dispatch status for ${lead.customerName}`}
          className="w-full rounded border border-sky-700/50 bg-zinc-950/70 px-1.5 py-0.5 text-[11px] font-medium text-sky-100 focus:outline-none"
        >
          {DISPATCH_STATUS_ORDER.map((s) => (
            <option key={s} value={s} className="bg-zinc-900">
              {DISPATCH_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (dispatching) {
    return (
      <div className="mt-2 space-y-1.5 rounded-md border border-zinc-700 bg-zinc-950/60 p-2">
        {error && <p className="text-[11px] text-red-300">{error}</p>}
        <input
          autoFocus
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          placeholder="Field agent name…"
          aria-label="Field agent name"
          className="w-full rounded border border-zinc-700 bg-zinc-950/70 px-1.5 py-1 text-[11px] text-zinc-100 focus:outline-none"
        />
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirmDispatch()}
            className="flex-1 rounded bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? 'Dispatching…' : 'Confirm dispatch'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setDispatching(false)}
            className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setError(null);
        setDispatching(true);
      }}
      className="mt-2 w-full rounded border border-sky-600/50 px-1.5 py-1 text-[10.5px] font-semibold text-sky-300 transition-colors hover:bg-sky-500/10"
    >
      Dispatch Mobile
    </button>
  );
}
