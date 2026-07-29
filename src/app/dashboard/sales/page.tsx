'use client';

/**
 * Sales & Intake — lead pipeline board.
 *
 * A Kanban of incoming customer leads across the intake funnel (New →
 * Contacted → Estimate Sent → Approved → Lost). Approved leads can be
 * converted directly into an Ops production RO. Backed by sales-db with a
 * local fallback so the board always renders.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  LEAD_STATUS_LABEL,
  LEAD_STATUS_ORDER,
  type IntakeLead,
  type LeadStatus,
} from '@/components/sales/types';
import { getLeads, updateLeadStatus } from '@/lib/sales-db';
import { MobileIntakeWizard } from '@/components/sales/MobileIntakeWizard';
import { LeadActionCard } from '@/components/sales/LeadActionCard';
import { LeadOwnerChip } from '@/components/sales/LeadOwnerChip';

const COLUMN_TONE: Record<LeadStatus, { text: string; bar: string }> = {
  NEW: { text: 'text-sky-300', bar: 'bg-sky-500' },
  CONTACTED: { text: 'text-violet-300', bar: 'bg-violet-500' },
  ESTIMATE_SENT: { text: 'text-amber-300', bar: 'bg-amber-500' },
  AOB_SIGNED: { text: 'text-cyan-300', bar: 'bg-cyan-500' },
  APPROVED: { text: 'text-emerald-300', bar: 'bg-emerald-500' },
  CONVERTED: { text: 'text-teal-300', bar: 'bg-teal-500' },
  LOST: { text: 'text-zinc-400', bar: 'bg-zinc-600' },
  LOST_TO_COMPETITOR: { text: 'text-rose-300', bar: 'bg-rose-500' },
  CANCELLED: { text: 'text-zinc-500', bar: 'bg-zinc-700' },
};

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function SalesIntakePage() {
  const [leads, setLeads] = useState<IntakeLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const refetch = useCallback(async () => {
    try {
      setLeads(await getLeads());
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Data sync failed');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setError(null);
        const rows = await getLeads();
        if (cancelled) return;
        setLeads(rows);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Data sync failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh-safe: re-pull leads when the tab/window regains focus so intake
  // submissions / conversions from other views reflect here.
  useEffect(() => {
    const onFocus = () => void refetch();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refetch]);

  const byStatus = useMemo(() => {
    const groups = {} as Record<LeadStatus, IntakeLead[]>;
    for (const s of LEAD_STATUS_ORDER) groups[s] = [];
    for (const lead of leads) groups[lead.status]?.push(lead);
    return groups;
  }, [leads]);

  const pipelineValue = useMemo(
    () =>
      leads
        .filter(
          (l) =>
            l.status !== 'LOST' &&
            l.status !== 'LOST_TO_COMPETITOR' &&
            l.status !== 'CANCELLED' &&
            l.status !== 'CONVERTED',
        )
        .reduce((sum, l) => sum + l.estimatedAmount, 0),
    [leads],
  );

  const moveLead = (id: string, status: LeadStatus) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    void updateLeadStatus(id, status);
  };

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Sales &amp; Intake</h1>
            <p className="text-sm text-zinc-400">
              Lead pipeline · {leads.length} leads ·{' '}
              <span className="text-emerald-300">{money(pipelineValue)} open pipeline</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
          >
            + New Mobile Intake
          </button>
        </header>

        {notice && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-emerald-300/70 hover:text-emerald-200"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {error ? (
          <div className="p-4 bg-red-950/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
            ⚠️ Error loading leads: {error}
          </div>
        ) : loading ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
            Loading leads…
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {LEAD_STATUS_ORDER.map((status) => {
              const tone = COLUMN_TONE[status];
              const items = byStatus[status];
              return (
                <section key={status} className="flex w-72 shrink-0 flex-col">
                  <header className="mb-2 flex items-center gap-2 px-1">
                    <span className={clsx('h-2 w-2 rounded-full', tone.bar)} aria-hidden />
                    <h2 className={clsx('text-sm font-semibold', tone.text)}>
                      {LEAD_STATUS_LABEL[status]}
                    </h2>
                    <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-400">
                      {items.length}
                    </span>
                  </header>

                  <div className="flex min-h-32 flex-1 flex-col gap-2 rounded-lg border border-dashed border-zinc-800 p-2">
                    {items.map((lead) => (
                      <div
                        key={lead.id}
                        className="rounded-lg border border-zinc-700/70 bg-zinc-800/80 p-3 text-left shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-zinc-100">
                            {lead.customerName}
                          </p>
                          <span className="shrink-0 text-xs font-semibold tabular-nums text-emerald-300">
                            {money(lead.estimatedAmount)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-zinc-400">
                          {lead.vehicleYear} {lead.vehicleMake} {lead.vehicleModel}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                          {lead.insuranceCarrier}
                          {lead.claimNumber ? ` · ${lead.claimNumber}` : ''}
                          {lead.vinLast8 ? ` · VIN …${lead.vinLast8}` : ''}
                        </p>
                        <p className="mt-0.5 text-[11px] text-zinc-600">
                          {lead.phone} · {new Date(lead.intakeDate).toLocaleDateString()}
                        </p>

                        <LeadOwnerChip
                          leadId={lead.id}
                          staffName={lead.assignedStaffName}
                          onAssigned={() => void refetch()}
                        />

                        <div className="mt-2">
                          <select
                            value={lead.status}
                            onChange={(e) => moveLead(lead.id, e.target.value as LeadStatus)}
                            aria-label={`Status for ${lead.customerName}`}
                            className="w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-1.5 py-1 text-[11px] font-medium text-zinc-200 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
                          >
                            {LEAD_STATUS_ORDER.map((s) => (
                              <option key={s} value={s} className="bg-zinc-900">
                                {LEAD_STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        </div>

                        {(lead.status === 'APPROVED' ||
                          lead.status === 'AOB_SIGNED' ||
                          lead.status === 'CONVERTED' ||
                          lead.status === 'CANCELLED' ||
                          lead.status === 'LOST_TO_COMPETITOR') && (
                          <div className="mt-2">
                            <LeadActionCard
                              leadId={lead.id}
                              leadStatus={lead.status}
                              hasClaim={Boolean(lead.claimNumber)}
                              isSigned={Boolean(lead.agreementAccepted) || lead.status === 'AOB_SIGNED'}
                              onStatusChange={() => void refetch()}
                            />
                          </div>
                        )}
                      </div>
                    ))}

                    {items.length === 0 && (
                      <p className="select-none px-1 py-6 text-center text-xs text-zinc-600">
                        No leads
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {wizardOpen && (
        <MobileIntakeWizard
          onClose={() => setWizardOpen(false)}
          onComplete={(lead) => {
            setLeads((prev) => [lead, ...prev]);
            setWizardOpen(false);
            setNotice(
              `Mobile intake captured — new lead created for ${lead.customerName}.`,
            );
          }}
        />
      )}
    </div>
  );
}
