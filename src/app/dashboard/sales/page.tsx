'use client';

/**
 * Sales & Intake — Hail-Optimized Catastrophe Lead Aggregator & Dispatch Hub.
 *
 * Dual-tab architecture:
 *  - Digital Inbound & Storm Triage: web/social leads with storm zip/tag
 *    attribution, damage photo upload, and an instant severity rating.
 *  - Field Agent Dispatch: leads captured on-site via the mobile intake
 *    wizard, tracking field estimators deployed to customer residences.
 *
 * Each tab is presented through the same 4 streamlined pipeline stages (New
 * Inquiries -> Triage & Routing -> Agreement Signed / AOB Executed ->
 * Fulfilled), a presentation-layer grouping of the underlying LeadStatus
 * (unchanged) plus dispatchStatus for mobile-only fulfillment. Closed leads
 * (Lost / Lost to Competitor / Cancelled) stay in a separate toggled panel.
 *
 * Backed by sales-db with a local fallback so the board always renders.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  LEAD_CHANNEL_LABEL,
  LEAD_STATUS_LABEL,
  STORM_SEVERITY_LABEL,
  type IntakeLead,
  type LeadChannel,
  type LeadStatus,
  type StormSeverity,
} from '@/components/sales/types';
import { getLeads, updateLeadStatus } from '@/lib/sales-db';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { fetchBoardOrders } from '@/lib/ops-data';
import { MOCK_BOARD_ORDERS } from '@/lib/ops-mock';
import { STAGE_META } from '@/lib/board';
import type { RoStage } from '@/lib/database.types';
import { MobileIntakeWizard } from '@/components/sales/MobileIntakeWizard';
import { QuickLeadModal } from '@/components/sales/QuickLeadModal';
import { DigitalIntakeQuickAdd } from '@/components/sales/DigitalIntakeQuickAdd';
import { LeadActionCard } from '@/components/sales/LeadActionCard';
import { LeadOwnerChip } from '@/components/sales/LeadOwnerChip';
import { LeadDetailDrawer } from '@/components/sales/LeadDetailDrawer';
import { RoutingActionPanel } from '@/components/sales/RoutingActionPanel';
import { CommissionPanel } from '@/components/sales/CommissionPanel';

/** The 4 streamlined pipeline gates shown on each tab's board. */
type SalesColumn = 'NEW_INQUIRIES' | 'TRIAGE_ROUTING' | 'AGREEMENT_SIGNED' | 'FULFILLED';

const COLUMN_ORDER: SalesColumn[] = [
  'NEW_INQUIRIES',
  'TRIAGE_ROUTING',
  'AGREEMENT_SIGNED',
  'FULFILLED',
];

const COLUMN_LABEL: Record<SalesColumn, string> = {
  NEW_INQUIRIES: 'New Inquiries',
  TRIAGE_ROUTING: 'Triage & Routing',
  AGREEMENT_SIGNED: 'Agreement Signed / AOB Executed',
  FULFILLED: 'Fulfilled',
};

const COLUMN_TONE: Record<SalesColumn, { text: string; bar: string }> = {
  NEW_INQUIRIES: { text: 'text-sky-300', bar: 'bg-sky-500' },
  TRIAGE_ROUTING: { text: 'text-amber-300', bar: 'bg-amber-500' },
  AGREEMENT_SIGNED: { text: 'text-cyan-300', bar: 'bg-cyan-500' },
  FULFILLED: { text: 'text-teal-300', bar: 'bg-teal-500' },
};

const TERMINAL_STATUSES: readonly LeadStatus[] = ['LOST', 'LOST_TO_COMPETITOR', 'CANCELLED'];

/**
 * The canonical LeadStatus each stage's dropdown option sets. Two legacy
 * granular values fold into each of TRIAGE_ROUTING (CONTACTED / ESTIMATE_SENT)
 * and AGREEMENT_SIGNED (AOB_SIGNED / APPROVED) — the card's stage select only
 * offers the canonical one going forward, so re-selecting a stage on an old
 * lead naturally retires the finer state without a data migration.
 */
const STAGE_STATUS: Record<SalesColumn, LeadStatus> = {
  NEW_INQUIRIES: 'NEW',
  TRIAGE_ROUTING: 'CONTACTED',
  AGREEMENT_SIGNED: 'AOB_SIGNED',
  FULFILLED: 'CONVERTED',
};

/** Maps a granular LeadStatus onto its streamlined stage (or null for a
 *  terminal/closed status). Presentation-only — LeadStatus is unchanged. */
function statusToStage(status: LeadStatus): SalesColumn | null {
  if (TERMINAL_STATUSES.includes(status)) return null;
  if (status === 'CONVERTED') return 'FULFILLED';
  if (status === 'AOB_SIGNED' || status === 'APPROVED') return 'AGREEMENT_SIGNED';
  if (status === 'CONTACTED' || status === 'ESTIMATE_SENT') return 'TRIAGE_ROUTING';
  return 'NEW_INQUIRIES';
}

/**
 * Maps a lead onto one of the 4 streamlined columns. Presentation-only — the
 * granular LeadStatus is unchanged underneath. Fulfilled additionally covers
 * a mobile house call marked COMPLETED (dispatchStatus, not LeadStatus),
 * since a mobile-only fulfillment never produces an RO / CONVERTED status.
 */
function pipelineColumn(lead: IntakeLead): SalesColumn | null {
  if (TERMINAL_STATUSES.includes(lead.status)) return null;
  if (lead.dispatchStatus === 'COMPLETED') return 'FULFILLED';
  return statusToStage(lead.status);
}

const HUB_TABS: { id: LeadChannel; label: string }[] = [
  { id: 'DIGITAL_INBOUND', label: LEAD_CHANNEL_LABEL.DIGITAL_INBOUND },
  { id: 'FIELD_DISPATCH', label: LEAD_CHANNEL_LABEL.FIELD_DISPATCH },
];

const SEVERITY_TONE: Record<StormSeverity, string> = {
  MINOR: 'border-zinc-600 bg-zinc-700/30 text-zinc-300',
  MODERATE: 'border-amber-500/50 bg-amber-500/10 text-amber-300',
  SEVERE: 'border-orange-500/50 bg-orange-500/10 text-orange-300',
  CATASTROPHIC: 'border-red-500/50 bg-red-500/10 text-red-300',
};

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Loads a claim_number -> production stage map from the shop Ops board, for
 *  the real-time production status badge on fulfilled/converted leads. */
async function loadStageByClaim(): Promise<Map<string, RoStage>> {
  const map = new Map<string, RoStage>();
  try {
    const supabase = getSupabaseBrowserClient();
    const { orders, error } = await fetchBoardOrders(supabase);
    const rows = !error && orders.length > 0 ? orders : MOCK_BOARD_ORDERS;
    for (const ro of rows) {
      if (ro.claim_number) map.set(ro.claim_number, ro.stage);
    }
  } catch {
    for (const ro of MOCK_BOARD_ORDERS) {
      if (ro.claim_number) map.set(ro.claim_number, ro.stage);
    }
  }
  return map;
}

/** Shared card render for both the 4-column board and the Closed panel —
 *  one definition guarantees metadata parity between the two. */
function LeadCard({
  lead,
  stageByClaim,
  onMove,
  onRefetch,
  onOpenDetail,
}: {
  lead: IntakeLead;
  stageByClaim: Map<string, RoStage>;
  onMove: (id: string, status: LeadStatus) => void;
  onRefetch: () => void;
  onOpenDetail: (lead: IntakeLead) => void;
}) {
  const productionStage = lead.status === 'CONVERTED' ? stageByClaim.get(lead.claimNumber) : undefined;
  const productionMeta = productionStage ? STAGE_META[productionStage] : null;
  const showRouting =
    lead.status !== 'NEW' && lead.status !== 'CONVERTED' && !TERMINAL_STATUSES.includes(lead.status);

  // The stage select only offers the 4 canonical stage statuses (+ Closed) —
  // a lead already sitting in a folded legacy status (ESTIMATE_SENT,
  // APPROVED) still needs its dropdown to show the matching stage selected.
  const currentStage = statusToStage(lead.status);
  const statusSelectValue: LeadStatus = currentStage ? STAGE_STATUS[currentStage] : lead.status;

  return (
    <div className="rounded-lg border border-zinc-700/70 bg-zinc-800/80 p-3 text-left shadow-sm transition-colors duration-200">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpenDetail(lead)}
          title="Open lead details"
          className="truncate text-left text-sm font-semibold text-zinc-100 hover:text-sky-300 hover:underline"
        >
          {lead.customerName}
        </button>
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

      {(lead.stormTag ||
        lead.zipCode ||
        lead.severity ||
        (lead.damagePhotos?.length ?? 0) > 0 ||
        (lead.additionalVehicles?.length ?? 0) > 0 ||
        lead.loanerRequestedUnfulfilled) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {lead.loanerRequestedUnfulfilled && (
            <span
              className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
              title="Customer wanted a loaner — not yet fulfilled. See Fleet."
            >
              🔑 Loaner needed
            </span>
          )}
          {(lead.additionalVehicles?.length ?? 0) > 0 && (
            <span
              className="rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300"
              title={lead.additionalVehicles
                ?.map((v) => `${v.vehicleYear ?? ''} ${v.vehicleMake ?? ''} ${v.vehicleModel ?? ''}`.trim())
                .join(', ')}
            >
              🚗 +{lead.additionalVehicles?.length} more vehicle
              {(lead.additionalVehicles?.length ?? 0) > 1 ? 's' : ''}
            </span>
          )}
          {lead.stormTag && (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
              ⛈ {lead.stormTag}
            </span>
          )}
          {lead.zipCode && (
            <span className="rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {lead.zipCode}
            </span>
          )}
          {lead.severity && (
            <span
              className={clsx(
                'rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                SEVERITY_TONE[lead.severity],
              )}
            >
              {STORM_SEVERITY_LABEL[lead.severity]}
            </span>
          )}
          {(lead.damagePhotos?.length ?? 0) > 0 && (
            <span className="rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-400">
              📷 {lead.damagePhotos?.length}
            </span>
          )}
        </div>
      )}

      {productionMeta && (
        <span
          className={clsx(
            'mt-1.5 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold',
            productionMeta.tone === 'red' && 'border-red-500/40 bg-red-500/10 text-red-300',
            productionMeta.tone === 'amber' && 'border-amber-500/40 bg-amber-500/10 text-amber-300',
            productionMeta.tone === 'neutral' && 'border-zinc-600/50 bg-zinc-700/30 text-zinc-300',
          )}
        >
          🏭 {productionMeta.label}
        </span>
      )}
      {!productionMeta && lead.dispatchStatus === 'COMPLETED' && (
        <span className="mt-1.5 inline-flex rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
          🏭 Mobile Service Completed
        </span>
      )}

      <LeadOwnerChip leadId={lead.id} staffName={lead.assignedStaffName} onAssigned={onRefetch} />

      <div className="mt-2">
        <select
          value={statusSelectValue}
          onChange={(e) => onMove(lead.id, e.target.value as LeadStatus)}
          aria-label={`Status for ${lead.customerName}`}
          className="w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-1.5 py-1 text-[11px] font-medium text-zinc-200 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
        >
          {COLUMN_ORDER.map((c) => (
            <option key={c} value={STAGE_STATUS[c]} className="bg-zinc-900">
              {COLUMN_LABEL[c]}
            </option>
          ))}
          <optgroup label="Closed">
            {TERMINAL_STATUSES.map((s) => (
              <option key={s} value={s} className="bg-zinc-900">
                {LEAD_STATUS_LABEL[s]}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {showRouting && <RoutingActionPanel lead={lead} onUpdated={onRefetch} />}

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
            onStatusChange={onRefetch}
          />
        </div>
      )}
    </div>
  );
}

export default function SalesIntakePage() {
  const [leads, setLeads] = useState<IntakeLead[]>([]);
  const [detailLead, setDetailLead] = useState<IntakeLead | null>(null);
  const [stageByClaim, setStageByClaim] = useState<Map<string, RoStage>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<LeadChannel>('DIGITAL_INBOUND');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [quickLeadOpen, setQuickLeadOpen] = useState(false);
  const [digitalAddOpen, setDigitalAddOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [showCommission, setShowCommission] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const [rows, stages] = await Promise.all([getLeads(), loadStageByClaim()]);
      setLeads(rows);
      setStageByClaim(stages);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Data sync failed');
    }
  }, []);

  // Guards the visibility-triggered refetch below: an in-flight ref so a
  // second trigger while one is still running short-circuits instead of
  // firing a redundant concurrent request, plus a debounce so rapid tab
  // switching doesn't refetch more than once every couple seconds.
  const refetchInFlightRef = useRef(false);
  const lastRefetchAtRef = useRef(0);
  const REFETCH_DEBOUNCE_MS = 2000;

  const guardedRefetch = useCallback(() => {
    if (refetchInFlightRef.current) return;
    const now = Date.now();
    if (now - lastRefetchAtRef.current < REFETCH_DEBOUNCE_MS) return;
    lastRefetchAtRef.current = now;
    refetchInFlightRef.current = true;
    void refetch().finally(() => {
      refetchInFlightRef.current = false;
    });
  }, [refetch]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setError(null);
        const [rows, stages] = await Promise.all([getLeads(), loadStageByClaim()]);
        if (cancelled) return;
        setLeads(rows);
        setStageByClaim(stages);
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
  // submissions / conversions from other views reflect here. A single
  // trigger (visibilitychange, only on the visible transition) — this used
  // to also listen for `window focus`, but that fires alongside
  // visibilitychange for the same tab-switch, producing two concurrent,
  // redundant getLeads() calls per switch with no guard between them.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') guardedRefetch();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [guardedRefetch]);

  const tabLeads = useMemo(
    () => leads.filter((l) => (l.channel ?? 'DIGITAL_INBOUND') === tab),
    [leads, tab],
  );

  // Group into the 4 streamlined columns (presentation-only) plus a separate
  // closed-leads bucket, scoped to the active hub tab.
  const byColumn = useMemo(() => {
    const groups = {} as Record<SalesColumn, IntakeLead[]>;
    for (const c of COLUMN_ORDER) groups[c] = [];
    for (const lead of tabLeads) {
      const column = pipelineColumn(lead);
      if (column) groups[column].push(lead);
    }
    return groups;
  }, [tabLeads]);

  const closedLeads = useMemo(
    () => tabLeads.filter((l) => TERMINAL_STATUSES.includes(l.status)),
    [tabLeads],
  );

  const pipelineValue = useMemo(
    () =>
      tabLeads
        .filter((l) => !TERMINAL_STATUSES.includes(l.status) && l.status !== 'CONVERTED')
        .reduce((sum, l) => sum + l.estimatedAmount, 0),
    [tabLeads],
  );

  const moveLead = (id: string, status: LeadStatus) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    // Refetch after persisting: a transition to AOB_SIGNED can auto-convert
    // the lead into an RO server-side, and the optimistic patch above doesn't
    // know that happened.
    void updateLeadStatus(id, status).then(() => refetch());
  };

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Catastrophe Lead Aggregator &amp; Dispatch Hub</h1>
            <p className="text-sm text-zinc-400">
              {tabLeads.length} leads on this tab ·{' '}
              <span className="text-emerald-300">{money(pipelineValue)} open pipeline</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCommission((v) => !v)}
              aria-pressed={showCommission}
              className={clsx(
                'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                showCommission
                  ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                  : 'border-zinc-700 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200',
              )}
            >
              Commission &amp; Lifecycle
            </button>
            <button
              type="button"
              onClick={() => setShowClosed((v) => !v)}
              aria-pressed={showClosed}
              className={clsx(
                'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                showClosed
                  ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                  : 'border-zinc-700 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200',
              )}
            >
              Closed ({closedLeads.length})
            </button>
            {tab === 'DIGITAL_INBOUND' ? (
              <button
                type="button"
                onClick={() => setDigitalAddOpen(true)}
                className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
              >
                + Add New Lead
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setQuickLeadOpen(true)}
                  className="rounded-md border border-sky-600/50 px-4 py-2 text-sm font-semibold text-sky-300 transition-colors hover:bg-sky-500/10"
                >
                  ⚡ Quick Capture
                </button>
                <button
                  type="button"
                  onClick={() => setWizardOpen(true)}
                  className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
                >
                  + New Mobile Intake
                </button>
              </>
            )}
          </div>
        </header>

        <div className="mb-5 inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5">
          {HUB_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={
                tab === t.id
                  ? 'rounded-md bg-sky-500/20 px-3 py-1.5 text-sm font-semibold text-sky-200'
                  : 'rounded-md px-3 py-1.5 text-sm font-medium text-zinc-400 hover:text-zinc-200'
              }
            >
              {t.label}
            </button>
          ))}
        </div>

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

        {showCommission && (
          <div className="mb-5">
            <CommissionPanel />
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
          <>
            <div className="flex gap-4 overflow-x-auto pb-4">
              {COLUMN_ORDER.map((column) => {
                const tone = COLUMN_TONE[column];
                const items = byColumn[column];
                return (
                  <section key={column} className="flex w-72 shrink-0 flex-col">
                    <header className="mb-2 flex items-center gap-2 px-1">
                      <span className={clsx('h-2 w-2 rounded-full', tone.bar)} aria-hidden />
                      <h2 className={clsx('text-sm font-semibold', tone.text)}>
                        {COLUMN_LABEL[column]}
                      </h2>
                      <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-400">
                        {items.length}
                      </span>
                    </header>

                    <div className="flex min-h-32 flex-1 flex-col gap-2 rounded-lg border border-dashed border-zinc-800 p-2">
                      {items.map((lead) => (
                        <LeadCard
                          key={lead.id}
                          lead={lead}
                          stageByClaim={stageByClaim}
                          onMove={moveLead}
                          onRefetch={() => void refetch()}
                          onOpenDetail={setDetailLead}
                        />
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

            {showClosed && (
              <section className="mt-2">
                <header className="mb-2 flex items-center gap-2 px-1">
                  <span className="h-2 w-2 rounded-full bg-zinc-600" aria-hidden />
                  <h2 className="text-sm font-semibold text-zinc-400">Closed</h2>
                  <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-400">
                    {closedLeads.length}
                  </span>
                </header>
                <div className="flex gap-3 overflow-x-auto rounded-lg border border-dashed border-zinc-800 p-2 pb-3">
                  {closedLeads.length === 0 ? (
                    <p className="select-none px-1 py-6 text-center text-xs text-zinc-600">
                      No closed leads
                    </p>
                  ) : (
                    closedLeads.map((lead) => (
                      <div key={lead.id} className="w-72 shrink-0">
                        <LeadCard
                          lead={lead}
                          stageByClaim={stageByClaim}
                          onMove={moveLead}
                          onRefetch={() => void refetch()}
                          onOpenDetail={setDetailLead}
                        />
                      </div>
                    ))
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {wizardOpen && (
        <MobileIntakeWizard
          onClose={() => setWizardOpen(false)}
          onComplete={(lead, holdMessage) => {
            setLeads((prev) => [lead, ...prev]);
            setWizardOpen(false);
            const base =
              lead.remoteAobStatus === 'SENT'
                ? `Mobile intake captured for ${lead.customerName} — Remote AOB link sent to the proxy policyholder.`
                : `Mobile intake captured — new lead created for ${lead.customerName}.`;
            setNotice(holdMessage ? `${base} ${holdMessage}` : base);
          }}
        />
      )}

      {quickLeadOpen && (
        <QuickLeadModal
          onClose={() => setQuickLeadOpen(false)}
          onComplete={(lead) => {
            setLeads((prev) => [lead, ...prev]);
            setQuickLeadOpen(false);
            setNotice(`Quick lead captured for ${lead.customerName}.`);
          }}
        />
      )}

      {digitalAddOpen && (
        <DigitalIntakeQuickAdd
          onClose={() => setDigitalAddOpen(false)}
          onComplete={(lead) => {
            setLeads((prev) => [lead, ...prev]);
            setDigitalAddOpen(false);
            setNotice(
              lead.remoteAobStatus === 'SENT'
                ? `Digital lead captured for ${lead.customerName} — Remote AOB link sent to the proxy policyholder.`
                : `Digital lead captured for ${lead.customerName}.`,
            );
          }}
        />
      )}

      {detailLead && (
        <LeadDetailDrawer
          lead={detailLead}
          onClose={() => setDetailLead(null)}
          onSaved={(updated) => {
            setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
            setDetailLead(null);
            setNotice(`Saved details for ${updated.customerName}.`);
          }}
        />
      )}
    </div>
  );
}
