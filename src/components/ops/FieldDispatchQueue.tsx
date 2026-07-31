'use client';

/**
 * FieldDispatchQueue — Ops/Shop Manager surface for mobile field dispatch.
 *
 * Ops Workflow Realignment: field deployment decisions live entirely here
 * now, not on Sales' lead cards. Dispatch still targets intake_leads
 * pre-conversion (Ops's Kanban board only has repair_orders, converted
 * leads), so this queries the same lead pipeline Sales uses — just as its
 * own dedicated view, gated to MANAGER/EXECUTIVE, with no DispatchButton
 * import anywhere in Sales code.
 */
import { useCallback, useEffect, useState } from 'react';
import { getLeads } from '@/lib/sales-db';
import { DispatchButton } from '@/components/sales/DispatchButton';
import type { IntakeLead, LeadStatus } from '@/components/sales/types';

const TERMINAL_STATUSES: readonly LeadStatus[] = ['LOST', 'LOST_TO_COMPETITOR', 'CANCELLED'];

/** Same eligibility Sales used to gate its routing switch on, minus leads
 *  already routed to a shop drop-off — nothing for dispatch to do there. */
function isDispatchEligible(lead: IntakeLead): boolean {
  return (
    lead.status !== 'NEW' &&
    lead.status !== 'CONVERTED' &&
    !TERMINAL_STATUSES.includes(lead.status) &&
    lead.routingPath !== 'SHOP_DROPOFF'
  );
}

export function FieldDispatchQueue() {
  const [leads, setLeads] = useState<IntakeLead[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const all = await getLeads();
    setLeads(all.filter(isDispatchEligible));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-sm text-zinc-500">Loading dispatch queue…</div>;
  }

  if (leads.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
        No leads awaiting field dispatch.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {leads.map((lead) => (
        <div
          key={lead.id}
          className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3"
        >
          <p className="truncate text-sm font-semibold text-zinc-100">{lead.customerName}</p>
          <p className="truncate text-xs text-zinc-500">
            {lead.vehicleYear} {lead.vehicleMake} {lead.vehicleModel}
            {lead.phone ? ` · ${lead.phone}` : ''}
          </p>
          <DispatchButton lead={lead} onUpdated={() => void refresh()} />
        </div>
      ))}
    </div>
  );
}
