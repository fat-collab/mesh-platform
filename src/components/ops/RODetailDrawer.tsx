'use client';

/**
 * RODetailDrawer — right-hand slide-over panel for a single repair order.
 *
 * Opened from an RO card click (page.tsx sets `selectedOrder`). Closes on the
 * ✕ button, a backdrop click, or Escape. Sections: header (customer / claim /
 * VIN with copy-last-8 / stage / gate), vehicle & job specs, a parts operations
 * panel (per-item status, invoice capture, discrepancy reporting), and a gate &
 * audit summary that can launch the resolution modal.
 *
 * Parts edits are session-local (no parts table exists in the schema yet); the
 * drawer is remounted per order (via `key` in page.tsx) so its parts state
 * seeds cleanly from the incoming `parts` prop.
 */
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  GATE_TYPE_LABEL,
  STAGE_META,
  gateTypeForStage,
  isHoldStage,
  riskTone,
  type BoardOrder,
} from '@/lib/board';
import {
  fetchPartsByClaim,
  flagPartDiscrepancy,
  importEstimateLineItems,
  markPartReceived,
  updatePartStatus,
} from '@/lib/ops-db';
import { parseEstimate, seedDemoEstimateParts } from '@/lib/estimate-parser';
import { getOEMSpecsByVIN } from '@/lib/ops-mock';
import { LockIcon } from './HoldGateBadge';
import { SupplementsPanel } from './SupplementsPanel';
import { RODrawerStaffingSection } from './RODrawerStaffingSection';
import { RODrawerPartsSection } from './RODrawerPartsSection';
import { RODrawerSupplementsSection } from './RODrawerSupplementsSection';
import { RODrawerLaborSection } from './RODrawerLaborSection';
import { RODrawerInvoiceSection } from './RODrawerInvoiceSection';
import { RODrawerCommsSection } from './RODrawerCommsSection';
import { ROStageGateGuard } from './ROStageGateGuard';
import type { ROStatus } from './workflow-rules-types';
import { CloseoutModal } from '@/components/CloseoutModal';
import { getSupplementsForRO } from '@/lib/supplement-db';
import { OpsTimelineDispatch, type StallStatus } from './OpsTimelineDispatch';
import { FleetRentalTracker } from '@/components/ops/FleetRentalTracker';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getCurrentProfile } from '@/lib/auth';
import {
  DISCREPANCY_REASONS,
  DISCREPANCY_REASON_LABEL,
  PART_SOURCING_LABEL,
  PART_STATUS_LABEL,
  type DiscrepancyReason,
  type PartSourcingTier,
  type PartStatus,
  type PartsLineItem,
  type StructuralMaterial,
} from './types';

const SOURCING_TONE: Record<PartSourcingTier, string> = {
  OEM: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  LKQ: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  AFTERMARKET: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  RECONDITIONED: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
};

interface PdrScan {
  id: string;
  panel: string;
  dentCountEstimate: number;
  sizeBreakdown: { dime: number; nickel: number; quarter: number; halfDollar: number };
  severity: string;
  recommendedMatrixRate: number;
}

const PDR_SEVERITY_TONE: Record<string, string> = {
  LOW: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  MEDIUM: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  HIGH: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  REPLACE: 'border-red-500/50 bg-red-500/15 text-red-200',
};

const MATERIAL_TONE: Record<StructuralMaterial, string> = {
  Aluminum: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  Steel: 'border-zinc-500/40 bg-zinc-600/30 text-zinc-200',
  'Mixed / UHSS': 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  'Carbon Composite': 'border-violet-500/40 bg-violet-500/15 text-violet-200',
};

const STAGE_TONE_CLASS: Record<'neutral' | 'amber' | 'red', string> = {
  neutral: 'border-zinc-600/60 bg-zinc-700/40 text-zinc-200',
  amber: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  red: 'border-red-500/40 bg-red-500/15 text-red-200',
};

const RISK_TONE_CLASS: Record<'low' | 'medium' | 'high', string> = {
  low: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  high: 'border-red-500/40 bg-red-500/10 text-red-300',
};

/** Per-status badge styling: green Received, blue In-Transit, red Discrepancy. */
const PART_STATUS_CLASS: Record<PartStatus, string> = {
  NEEDED: 'border-zinc-600/60 bg-zinc-700/40 text-zinc-300',
  ORDERED: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  IN_TRANSIT: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  RECEIVED: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  DISCREPANCY: 'border-red-500/50 bg-red-500/15 text-red-200',
};

const PART_STATUSES: PartStatus[] = [
  'NEEDED',
  'ORDERED',
  'IN_TRANSIT',
  'RECEIVED',
  'DISCREPANCY',
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-zinc-100">{children}</p>
    </div>
  );
}

/** The inline form currently open on a line item, if any. */
type ActiveForm = { index: number; type: 'receive' | 'report' } | null;

export interface RODetailDrawerProps {
  order: BoardOrder | null;
  onClose: () => void;
  onRequestUnlock?: (order: BoardOrder) => void;
  /** Parts line items for this order (seeds session-local state). */
  parts?: PartsLineItem[];
}

export function RODetailDrawer({
  order,
  onClose,
  onRequestUnlock,
  parts = [],
}: RODetailDrawerProps) {
  // Seeded once per mount from the mock/prop; page.tsx keys the drawer by order
  // id so a new order remounts with fresh parts state. Replaced by live rows
  // when the parts table is initialized (dbBacked), else stays local.
  const [items, setItems] = useState<PartsLineItem[]>(parts);
  const [dbBacked, setDbBacked] = useState(false);
  const [activeForm, setActiveForm] = useState<ActiveForm>(null);

  // Receive-form fields.
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceUrl, setInvoiceUrl] = useState('');
  const [invoiceFileName, setInvoiceFileName] = useState<string | null>(null);
  // Report-form fields.
  const [reason, setReason] = useState<DiscrepancyReason>(DISCREPANCY_REASONS[0]);
  const [rmaNumber, setRmaNumber] = useState('');
  const [replacementDate, setReplacementDate] = useState('');
  const [discrepancyNotes, setDiscrepancyNotes] = useState('');

  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [oemOpen, setOemOpen] = useState(true);
  const [scopingOpen, setScopingOpen] = useState(false);
  const [pdrOpen, setPdrOpen] = useState(false);
  const [pdrScans, setPdrScans] = useState<PdrScan[]>([]);
  const [pdrMsg, setPdrMsg] = useState<string | null>(null);

  // Estimate import UI.
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Workflow status (gated by automated rules); local until an ROStatus column
  // exists — the guard prevents invalid transitions regardless of persistence.
  const [workflowStatus, setWorkflowStatus] = useState<ROStatus>('INTAKE');

  // Financial closeout gate. The two untracked checks (deductible / insurance)
  // are manager attestations; parts/supplements counts are derived.
  const [closeoutOpen, setCloseoutOpen] = useState(false);
  const [deductibleCollected, setDeductibleCollected] = useState(false);
  const [insuranceCleared, setInsuranceCleared] = useState(false);
  const [pendingSupplementsCount, setPendingSupplementsCount] = useState(0);
  const [insuranceStall, setInsuranceStall] = useState<StallStatus>('ACTIVE');
  // Signed-in user's role — gates the FleetRentalTracker override action.
  const [currentUserRole, setCurrentUserRole] = useState<string | undefined>(undefined);

  useEffect(() => {
    setShown(Boolean(order));
  }, [order]);

  // Load live parts for this claim. If the table has rows, switch to the
  // DB-backed path (mutations persist + re-fetch). On error (table not yet
  // initialized) or no rows, keep the local mock state seeded above.
  useEffect(() => {
    const claim = order?.claim_number;
    if (!claim) return;
    let cancelled = false;
    void (async () => {
      const { items: rows, error } = await fetchPartsByClaim(claim);
      if (cancelled) return;
      if (!error && rows.length > 0) {
        setItems(rows);
        setDbBacked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order?.id, order?.claim_number]);

  // Pending (unpaid) supplements for the closeout gate — canonical claim-scoped.
  useEffect(() => {
    if (!order) return;
    let cancelled = false;
    void (async () => {
      const recs = await getSupplementsForRO(order.id, order.claim_number ?? undefined);
      if (!cancelled) {
        setPendingSupplementsCount(recs.filter((r) => r.lifecycleStatus !== 'PAID').length);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order?.id, order?.claim_number]);

  // Resolve the signed-in user's role once (for the rental override gate).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getCurrentProfile(getSupabaseBrowserClient());
        if (!cancelled) setCurrentUserRole(profile?.role ?? undefined);
      } catch {
        /* no session — override simply stays unavailable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live insurance No-Stall status for this RO — most severe across its claims.
  useEffect(() => {
    if (!order) return;
    let cancelled = false;
    void (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase
          .from('insurance_payments')
          .select('stall_status')
          .eq('repair_order_id', order.id);
        if (cancelled) return;
        const rows = (data as { stall_status: string | null }[] | null) ?? [];
        const SEV: Record<StallStatus, number> = {
          ACTIVE: 0,
          PENDING_NUDGE: 1,
          MANAGER_ESCALATED: 2,
          SUPERVISOR_ESCALATED: 3,
        };
        let worst: StallStatus = 'ACTIVE';
        for (const r of rows) {
          const s = (r.stall_status ?? 'ACTIVE') as StallStatus;
          if (SEV[s] > SEV[worst]) worst = s;
        }
        setInsuranceStall(worst);
      } catch {
        /* ignore — default ACTIVE */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order?.id]);

  // Closeout: PATCH the gate route; throws on failure so CloseoutModal surfaces
  // the blocker. The route re-enforces parts/supplements server-side.
  const handleExecuteCloseout = async () => {
    if (!order) return;
    const res = await fetch(`/api/v1/repair-orders/${order.id}/close`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deductibleCollected, insuranceCleared }),
    });
    const result = (await res.json()) as { success?: boolean; message?: string; error?: string };
    if (!res.ok || !result.success) {
      throw new Error(result.error || 'Closeout authorization failed.');
    }
  };

  useEffect(() => {
    if (!order) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [order, onClose]);

  if (!order) return null;

  const stageMeta = STAGE_META[order.stage];
  const gateType = gateTypeForStage(order.stage);
  const inHoldStage = isHoldStage(order.stage);
  const locked = order.hold_gate_active;
  const vinLast8 = order.vin ? order.vin.slice(-8) : null;
  const oemSpecs = vinLast8 ? getOEMSpecsByVIN(vinLast8) : null;
  const discrepancies = items.filter((i) => i.status === 'DISCREPANCY');

  const copyLast8 = async () => {
    if (!vinLast8) return;
    try {
      await navigator.clipboard.writeText(vinLast8);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  const openReceive = (index: number) => {
    const item = items[index];
    setInvoiceNumber(item.invoiceNumber ?? '');
    setInvoiceUrl(item.invoiceUrl ?? '');
    setInvoiceFileName(null);
    setActiveForm({ index, type: 'receive' });
  };

  const openReport = (index: number) => {
    const item = items[index];
    setReason(item.discrepancyReason ?? DISCREPANCY_REASONS[0]);
    setRmaNumber(item.returnRmaNumber ?? '');
    setReplacementDate(item.replacementExpectedDate ?? '');
    setDiscrepancyNotes(item.discrepancyNotes ?? '');
    setActiveForm({ index, type: 'report' });
  };

  const updateItem = (index: number, patch: Partial<PartsLineItem>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
    setActiveForm(null);
  };

  // Re-pull live rows after a successful mutation so local state matches the DB.
  const refetch = async () => {
    const claim = order?.claim_number;
    if (!claim) return;
    const { items: rows, error } = await fetchPartsByClaim(claim);
    if (!error) setItems(rows);
  };

  const submitReceive = async (index: number) => {
    const item = items[index];
    const invNum = invoiceNumber.trim() || null;
    const invUrl = invoiceUrl.trim() || null;

    // Optimistic local update (also the sole update in the mock/fallback path).
    updateItem(index, {
      status: 'RECEIVED',
      invoiceNumber: invNum,
      invoiceUrl: invUrl,
      discrepancyReason: null,
      discrepancyNotes: null,
      returnRmaNumber: null,
      replacementExpectedDate: null,
    });

    if (dbBacked && item.id) {
      const { error } = await markPartReceived(item.id, {
        invoiceNumber: invNum,
        invoiceUrl: invUrl,
      });
      if (error) {
        console.warn('[ops] mark-received persistence failed; keeping local state:', error);
      } else {
        await refetch();
      }
    }
  };

  const submitReport = async (index: number) => {
    const item = items[index];
    const rma = rmaNumber.trim() || null;
    const eta = replacementDate || null;
    const notes = discrepancyNotes.trim() || null;

    updateItem(index, {
      status: 'DISCREPANCY',
      discrepancyReason: reason,
      returnRmaNumber: rma,
      replacementExpectedDate: eta,
      discrepancyNotes: notes,
    });

    if (dbBacked && item.id) {
      const { error } = await flagPartDiscrepancy(item.id, {
        reason,
        rmaNumber: rma,
        replacementDate: eta,
        notes,
      });
      if (error) {
        console.warn('[ops] discrepancy persistence failed; keeping local state:', error);
      } else {
        await refetch();
      }
    }
  };

  const onInvoiceFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setInvoiceFileName(file.name);
    setInvoiceUrl(URL.createObjectURL(file));
  };

  // --- estimate import -----------------------------------------------------

  const runImport = async (parsed: PartsLineItem[], sourceLabel: string) => {
    if (parsed.length === 0) return;
    const claim = order.claim_number ?? '';
    setImporting(true);

    // Optimistic append with temporary ids, then reconcile with persisted rows.
    const tmp: PartsLineItem[] = parsed.map((p, i) => ({ ...p, id: `tmp-${i}-${p.name}` }));
    const tmpIds = new Set<string>(tmp.map((t) => t.id as string));
    setItems((prev) => [...prev, ...tmp]);

    const saved = await importEstimateLineItems(claim, parsed);

    setItems((prev) => [...prev.filter((it) => !tmpIds.has(it.id ?? '')), ...saved]);
    setImporting(false);
    setImportMsg(
      `${sourceLabel}: imported ${saved.length} line item${saved.length === 1 ? '' : 's'}.`,
    );
  };

  const handleQuickSeed = () => {
    void runImport(seedDemoEstimateParts(order.claim_number ?? 'CLAIM'), 'Quick seed');
  };

  const handleParseImport = () => {
    const parsed = parseEstimate(importText);
    setImportText('');
    setImportOpen(false);
    if (parsed.length > 0) {
      void runImport(parsed, 'Estimate import');
    } else {
      void runImport(
        seedDemoEstimateParts(order.claim_number ?? 'CLAIM'),
        'Could not parse input — seeded demo estimate',
      );
    }
  };

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setImportText(text);
      setImportMsg(`Loaded ${file.name} — review, then Parse & Import.`);
    } catch {
      setImportMsg('Could not read file.');
    }
  };

  // Quick status toggle. DISCREPANCY routes through the report form so the
  // operator tags a reason (RMA / ETA / notes) before it is persisted.
  const handleStatusChange = async (index: number, next: PartStatus) => {
    if (next === 'DISCREPANCY') {
      openReport(index);
      return;
    }
    const item = items[index];
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, status: next } : it)));
    if (item.id) {
      await updatePartStatus(item.id, next);
    }
  };

  // Stage-2 PDR grid scan → append a panel matrix breakdown to the RO estimate.
  const scanPdrGrid = async (file: File | undefined) => {
    if (!file) return;
    setPdrMsg('Scanning grid…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('docType', 'PDR_DENT_GRID');
      const res = await fetch('/api/v1/vision/ocr', { method: 'POST', body: fd });
      const json = (await res.json()) as {
        success?: boolean;
        data?: Record<string, unknown>;
        provider?: string;
      };
      if (!json.success || !json.data) {
        setPdrMsg('Could not read grid — try another photo.');
        return;
      }
      const d = json.data;
      const sb = (d.sizeBreakdown ?? {}) as Record<string, unknown>;
      const numOf = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
      const scan: PdrScan = {
        id: `pdr-${Date.now()}-${pdrScans.length}`,
        panel: typeof d.panel === 'string' ? d.panel : 'PANEL',
        dentCountEstimate: numOf(d.dentCountEstimate),
        sizeBreakdown: {
          dime: numOf(sb.dime),
          nickel: numOf(sb.nickel),
          quarter: numOf(sb.quarter),
          halfDollar: numOf(sb.halfDollar),
        },
        severity: typeof d.severity === 'string' ? d.severity : 'MEDIUM',
        recommendedMatrixRate: numOf(d.recommendedMatrixRate),
      };
      setPdrScans((prev) => [...prev, scan]);
      setPdrMsg(
        `✓ ${scan.panel}: ${scan.dentCountEstimate} dents · matrix $${scan.recommendedMatrixRate}${
          json.provider === 'mock' ? ' (sample)' : ''
        }.`,
      );
    } catch {
      setPdrMsg('Scan failed — try again.');
    }
  };

  const pdrTotal = pdrScans.reduce((s, x) => s + x.recommendedMatrixRate, 0);

  const inputClass =
    'w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Repair order ${order.claim_number ?? ''}`}
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          'flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-900 shadow-2xl transition-transform duration-200 ease-out',
          shown ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900/95 p-5 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-zinc-100">
                {order.customer_name ?? 'Unknown customer'}
              </p>
              <p className="font-mono text-xs font-semibold text-sky-400">
                {order.claim_number ?? 'NO CLAIM'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              ✕
            </button>
          </div>

          {/* VIN + copy last 8 */}
          <div className="mt-3 flex items-center gap-2">
            <span className="font-mono text-xs text-zinc-400">VIN {order.vin ?? '—'}</span>
            {vinLast8 && (
              <button
                type="button"
                onClick={copyLast8}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-sky-500/50 hover:text-sky-200"
                title={`Copy last 8: ${vinLast8}`}
              >
                {copied ? '✓ Copied' : 'Copy Last 8'}
              </button>
            )}
          </div>

          {/* Stage + gate status badges */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span
              className={clsx(
                'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold',
                STAGE_TONE_CLASS[stageMeta.tone],
              )}
            >
              {stageMeta.label}
            </span>
            {locked && gateType ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-200">
                <LockIcon className="h-3 w-3" />
                {GATE_TYPE_LABEL[gateType]}
              </span>
            ) : (
              inHoldStage && (
                <span className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                  Gate resolved
                </span>
              )
            )}
          </div>
        </div>

        <div className="flex-1 space-y-5 p-5">
          {/* Vehicle & job specs */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Vehicle &amp; Job Specs
            </h3>
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <Field label="Vehicle">{order.vehicle}</Field>
              <Field label="VIN">
                <span className="font-mono text-xs">{order.vin ?? '—'}</span>
              </Field>
              <Field label="Aluminum Body">
                {order.aluminum ? 'Yes · Specialized Bay' : 'Standard'}
              </Field>
              <Field label="Risk / Total Loss">
                {order.risk_score != null ? (
                  <span
                    className={clsx(
                      'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                      RISK_TONE_CLASS[riskTone(order.risk_score)],
                    )}
                  >
                    TL {order.risk_score.toFixed(2)}
                    {order.stage === 'HOLD_TOTAL_LOSS' ? ' · Total Loss' : ''}
                  </span>
                ) : (
                  <span className="text-zinc-500">No audit</span>
                )}
              </Field>
            </div>
          </section>

          {/* Field intake context (from mobile intake bridge) */}
          {(order.insuranceCarrier ||
            order.assignedStaffName ||
            order.intakeNotes ||
            (order.intakeHail && order.intakeHail.length > 0) ||
            (order.intakeDocuments && order.intakeDocuments.length > 0)) && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Field Intake
              </h3>
              <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs">
                {order.assignedStaffName && (
                  <p className="text-zinc-300">
                    <span className="text-zinc-500">Intake rep: </span>
                    {order.assignedStaffName}
                  </p>
                )}
                {order.insuranceCarrier && (
                  <p className="text-zinc-300">
                    <span className="text-zinc-500">Carrier: </span>
                    {order.insuranceCarrier}
                  </p>
                )}
                {order.intakeHail && order.intakeHail.length > 0 && (
                  <div>
                    <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                      Hail matrix
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {order.intakeHail.map((h, i) => (
                        <span
                          key={i}
                          className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200"
                        >
                          {h.panel}: {h.severity}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {order.intakeNotes && (
                  <p className="text-zinc-300">
                    <span className="text-zinc-500">Notes: </span>
                    {order.intakeNotes}
                  </p>
                )}
                {order.intakeDocuments && order.intakeDocuments.length > 0 && (
                  <div>
                    <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                      Documents
                    </p>
                    <ul className="space-y-0.5">
                      {order.intakeDocuments.map((d, i) => (
                        <li key={i} className="truncate text-zinc-400">
                          • {d.kind}:{' '}
                          {d.url ? (
                            <a
                              href={d.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sky-400 hover:underline"
                            >
                              {d.fileName}
                            </a>
                          ) : (
                            d.fileName
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Workflow status — automated stage-gate enforcement */}
          <ROStageGateGuard
            repairOrderId={order.id}
            status={workflowStatus}
            onStatusChange={setWorkflowStatus}
          />

          {/* Financial closeout — clearance gate before archiving the RO */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Financial Closeout
            </h3>
            <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={deductibleCollected}
                  onChange={(e) => setDeductibleCollected(e.target.checked)}
                />
                Customer deductible collected
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={insuranceCleared}
                  onChange={(e) => setInsuranceCleared(e.target.checked)}
                />
                Primary insurance payout cleared
              </label>
              <button
                type="button"
                onClick={() => setCloseoutOpen(true)}
                className="w-full rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500"
              >
                Review Financial Closeout
              </button>
            </div>
          </section>

          {/* Ops timeline & AI dispatch + insurance No-Stall badge */}
          <OpsTimelineDispatch repairOrderId={order.id} stallStatus={insuranceStall} />

          {/* Fleet, external rentals & reimbursement gate (+ manager override) */}
          <FleetRentalTracker
            repairOrderId={order.id}
            userRole={currentUserRole}
            repairEtaDate={order.targetDeliveryDate ?? undefined}
          />

          {/* Staffing — relational multi-role RO assignments */}
          <RODrawerStaffingSection repairOrderId={order.id} />

          {/* Parts procurement — RO-scoped parts list */}
          <RODrawerPartsSection repairOrderId={order.id} />

          {/* Supplements — RO-scoped supplement ledger */}
          <RODrawerSupplementsSection
            repairOrderId={order.id}
            claimNumber={order.claim_number ?? ''}
            customerName={order.customer_name}
            vehicle={order.vehicle}
            insuranceCarrier={order.insuranceCarrier ?? ''}
          />

          {/* Labor & technician time tracking */}
          <RODrawerLaborSection repairOrderId={order.id} />

          {/* Invoicing & accounts receivable */}
          <RODrawerInvoiceSection
            repairOrderId={order.id}
            claimNumber={order.claim_number ?? ''}
          />

          {/* Customer communication & SMS tracking */}
          <RODrawerCommsSection repairOrderId={order.id} />

          {/* OEM specs & structural body rules */}
          <section>
            <button
              type="button"
              onClick={() => setOemOpen((v) => !v)}
              aria-expanded={oemOpen}
              className="flex w-full items-center justify-between text-left"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                OEM Specs &amp; Structural Body Rules
              </h3>
              <span className="text-zinc-500">{oemOpen ? '▾' : '▸'}</span>
            </button>

            {oemOpen &&
              (oemSpecs ? (
                <div className="mt-2 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  {/* Key specs */}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Paint">
                      <span className="font-mono text-xs">{oemSpecs.paintCode}</span>
                      <span className="ml-1 text-zinc-300">· {oemSpecs.paintName}</span>
                    </Field>
                    <Field label="Trim">{oemSpecs.trimPackage}</Field>
                    <Field label="Body Type">{oemSpecs.bodyType}</Field>
                    <Field label="Structural Material">
                      <span
                        className={clsx(
                          'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold',
                          MATERIAL_TONE[oemSpecs.structuralMaterial],
                        )}
                      >
                        {oemSpecs.structuralMaterial}
                      </span>
                    </Field>
                  </div>

                  {/* Mandatory OEM scan alert */}
                  {oemSpecs.oemScanRequired && (
                    <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-200">
                      <span aria-hidden>🛑</span>
                      Mandatory OEM pre- &amp; post-repair ADAS scan required.
                    </div>
                  )}

                  {/* Structural repair rules */}
                  <div>
                    <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                      Structural Repair Rules
                    </p>
                    <ul className="space-y-1.5">
                      {oemSpecs.structuralRules.map((rule, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-100"
                        >
                          <span className="mt-0.5 shrink-0" aria-hidden>
                            ⚠️
                          </span>
                          <span>{rule}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* OEM repair manual reference */}
                  <a
                    href="https://www.oem1stop.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-200 transition-colors hover:bg-sky-500/20"
                  >
                    OEM Repair Manual Reference ↗
                  </a>
                </div>
              ) : (
                <p className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-500">
                  A VIN is required to look up OEM specs and structural rules.
                </p>
              ))}
          </section>

          {/* PDR dent grid analyzer (Stage 2) */}
          <section>
            <button
              type="button"
              onClick={() => setPdrOpen((v) => !v)}
              aria-expanded={pdrOpen}
              className="flex w-full items-center justify-between text-left"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                PDR Dent Grid Analyzer
              </h3>
              <span className="text-zinc-500">{pdrOpen ? '▾' : '▸'}</span>
            </button>

            {pdrOpen && (
              <div className="mt-2 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500">
                  📷 Scan PDR Grid
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => void scanPdrGrid(e.target.files?.[0])}
                  />
                </label>
                {pdrMsg && (
                  <p className="text-center text-[11px] text-zinc-400">{pdrMsg}</p>
                )}

                {pdrScans.length > 0 && (
                  <>
                    <ul className="space-y-1.5">
                      {pdrScans.map((s) => (
                        <li
                          key={s.id}
                          className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-zinc-100">{s.panel}</span>
                            <span
                              className={clsx(
                                'rounded-md border px-1.5 py-0.5 text-[10px] font-semibold',
                                PDR_SEVERITY_TONE[s.severity] ?? PDR_SEVERITY_TONE.MEDIUM,
                              )}
                            >
                              {s.severity}
                            </span>
                          </div>
                          <p className="mt-0.5 text-zinc-400">
                            {s.dentCountEstimate} dents · dime {s.sizeBreakdown.dime} · nickel{' '}
                            {s.sizeBreakdown.nickel} · quarter {s.sizeBreakdown.quarter} · ½$
                            {s.sizeBreakdown.halfDollar}
                          </p>
                          <p className="text-[11px] text-emerald-300">
                            Matrix rate ${s.recommendedMatrixRate}
                          </p>
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center justify-between border-t border-zinc-800 pt-2 text-xs">
                      <span className="text-zinc-500">RO PDR estimate (matrix)</span>
                      <span className="font-semibold tabular-nums text-emerald-300">
                        ${pdrTotal.toLocaleString()}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>

          {/* Parts & line items */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Parts &amp; Line Items
              </h3>
              <span className="text-[11px] tabular-nums text-zinc-500">
                {items.length} item{items.length === 1 ? '' : 's'}
              </span>
            </div>

            {/* Estimate import actions */}
            <div className="mb-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={handleQuickSeed}
                disabled={importing}
                className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/20 disabled:opacity-50"
              >
                ⚡ Quick Seed Estimate
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportOpen((v) => !v);
                  setImportMsg(null);
                }}
                aria-expanded={importOpen}
                className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800"
              >
                ⇪ Import Estimate (CCC ONE / Mitchell)
              </button>
            </div>

            {importOpen && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  void handleFiles(e.dataTransfer.files);
                }}
                className={clsx(
                  'mb-2 space-y-2 rounded-lg border p-2',
                  dragActive
                    ? 'border-sky-500/60 bg-sky-500/5'
                    : 'border-zinc-700 bg-zinc-950/60',
                )}
              >
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={5}
                  placeholder="Paste CIECA BMS / EMS JSON or XML, or CSV/tab line items… or drop a .json / .xml / .csv / .txt file here."
                  className={clsx(inputClass, 'resize-none font-mono')}
                />
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="file"
                    accept=".json,.xml,.csv,.txt"
                    onChange={(e) => void handleFiles(e.target.files)}
                    className="block w-full text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-0.5 file:text-zinc-200"
                  />
                  <button
                    type="button"
                    onClick={handleParseImport}
                    disabled={importing}
                    className="shrink-0 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                  >
                    Parse &amp; Import Parts
                  </button>
                </div>
              </div>
            )}

            {importMsg && (
              <p className="mb-2 rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-[11px] text-zinc-300">
                {importMsg}
              </p>
            )}

            {/* Active discrepancy banners */}
            {discrepancies.length > 0 && (
              <div className="mb-2 space-y-1.5">
                {discrepancies.map((d, i) => (
                  <div
                    key={`disc-${d.name}-${i}`}
                    className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200"
                  >
                    <span className="font-semibold">⚠ {d.name}</span> —{' '}
                    {d.discrepancyReason
                      ? DISCREPANCY_REASON_LABEL[d.discrepancyReason]
                      : 'Discrepancy'}
                    {d.returnRmaNumber ? ` · RMA ${d.returnRmaNumber}` : ''}
                    {d.replacementExpectedDate ? ` · ETA ${d.replacementExpectedDate}` : ''}
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              {items.length > 0 ? (
                <ul className="space-y-2.5">
                  {items.map((item, i) => {
                    const isReceiveOpen =
                      activeForm?.index === i && activeForm.type === 'receive';
                    const isReportOpen =
                      activeForm?.index === i && activeForm.type === 'report';
                    return (
                      <li
                        key={`${item.name}-${i}`}
                        className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm text-zinc-100">{item.name}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <span
                                className={clsx(
                                  'inline-flex items-center rounded border px-1 py-0.5 text-[10px] font-semibold',
                                  SOURCING_TONE[item.sourcingTier],
                                )}
                              >
                                {PART_SOURCING_LABEL[item.sourcingTier]}
                              </span>
                              {item.sourcingTier === 'AFTERMARKET' &&
                                item.capaCertified != null &&
                                (item.capaCertified ? (
                                  <span className="inline-flex items-center rounded border border-emerald-500/40 bg-emerald-500/10 px-1 py-0.5 text-[10px] font-semibold text-emerald-300">
                                    CAPA ✓
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center rounded border border-red-500/40 bg-red-500/10 px-1 py-0.5 text-[10px] font-semibold text-red-300">
                                    Non-CAPA
                                  </span>
                                ))}
                            </div>
                            <p className="mt-0.5 text-[11px] text-zinc-500">
                              {item.leadTimeDays != null
                                ? `${item.leadTimeDays}d lead`
                                : 'No lead time'}
                              {item.invoiceNumber ? ` · Inv ${item.invoiceNumber}` : ''}
                              {item.invoiceUrl ? (
                                <>
                                  {' · '}
                                  <a
                                    href={item.invoiceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sky-400 hover:text-sky-300 hover:underline"
                                  >
                                    invoice
                                  </a>
                                </>
                              ) : (
                                ''
                              )}
                            </p>
                          </div>
                          <select
                            value={item.status}
                            onChange={(e) =>
                              void handleStatusChange(i, e.target.value as PartStatus)
                            }
                            aria-label={`Status for ${item.name}`}
                            className={clsx(
                              'shrink-0 cursor-pointer rounded-md border px-1.5 py-0.5 text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-sky-500/40',
                              PART_STATUS_CLASS[item.status],
                            )}
                          >
                            {PART_STATUSES.map((s) => (
                              <option
                                key={s}
                                value={s}
                                className="bg-zinc-900 text-zinc-100"
                              >
                                {PART_STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Action / Report Exception menu */}
                        {!isReceiveOpen && !isReportOpen && (
                          <div className="mt-2 flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => openReceive(i)}
                              className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20"
                            >
                              Mark Received
                            </button>
                            <button
                              type="button"
                              onClick={() => openReport(i)}
                              className="rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-300 hover:bg-red-500/20"
                            >
                              Report Broken / Wrong
                            </button>
                          </div>
                        )}

                        {/* Mark Received form */}
                        {isReceiveOpen && (
                          <div className="mt-2 space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2">
                            <input
                              value={invoiceNumber}
                              onChange={(e) => setInvoiceNumber(e.target.value)}
                              placeholder="Invoice # (optional)"
                              className={inputClass}
                            />
                            <input
                              value={invoiceUrl}
                              onChange={(e) => setInvoiceUrl(e.target.value)}
                              placeholder="Invoice URL (optional)"
                              className={inputClass}
                            />
                            <label className="block text-[11px] text-zinc-400">
                              <span className="mb-1 block">Or upload invoice file</span>
                              <input
                                type="file"
                                onChange={onInvoiceFile}
                                className="block w-full text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-0.5 file:text-zinc-200"
                              />
                              {invoiceFileName && (
                                <span className="mt-1 block truncate text-emerald-300">
                                  Attached: {invoiceFileName}
                                </span>
                              )}
                            </label>
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setActiveForm(null)}
                                className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => submitReceive(i)}
                                className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-500"
                              >
                                Confirm Received
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Report Discrepancy form */}
                        {isReportOpen && (
                          <div className="mt-2 space-y-2 rounded-md border border-red-500/30 bg-red-500/5 p-2">
                            <select
                              value={reason}
                              onChange={(e) =>
                                setReason(e.target.value as DiscrepancyReason)
                              }
                              className={inputClass}
                            >
                              {DISCREPANCY_REASONS.map((r) => (
                                <option key={r} value={r}>
                                  {DISCREPANCY_REASON_LABEL[r]}
                                </option>
                              ))}
                            </select>
                            <input
                              value={rmaNumber}
                              onChange={(e) => setRmaNumber(e.target.value)}
                              placeholder="Return RMA # (optional)"
                              className={inputClass}
                            />
                            <label className="block text-[11px] text-zinc-400">
                              <span className="mb-1 block">Replacement ETA</span>
                              <input
                                type="date"
                                value={replacementDate}
                                onChange={(e) => setReplacementDate(e.target.value)}
                                className={inputClass}
                              />
                            </label>
                            <textarea
                              value={discrepancyNotes}
                              onChange={(e) => setDiscrepancyNotes(e.target.value)}
                              rows={2}
                              placeholder="Notes (optional)"
                              className={clsx(inputClass, 'resize-none')}
                            />
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setActiveForm(null)}
                                className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => submitReport(i)}
                                className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-red-500"
                              >
                                Flag Discrepancy
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-zinc-500">
                  No parts line items are tracked for this order yet.
                </p>
              )}
            </div>
          </section>

          {/* Internal scoping & supplements */}
          <section>
            <button
              type="button"
              onClick={() => setScopingOpen((v) => !v)}
              aria-expanded={scopingOpen}
              className="flex w-full items-center justify-between text-left"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Internal Scoping &amp; Supplements
              </h3>
              <span className="text-zinc-500">{scopingOpen ? '▾' : '▸'}</span>
            </button>
            {scopingOpen && <SupplementsPanel claimNumber={order.claim_number} />}
          </section>

          {/* Gate & audit summary */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Gate &amp; Audit Summary
            </h3>
            {locked ? (
              <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="flex items-center gap-2 text-amber-200">
                  <LockIcon className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-semibold">
                    Active hold: {gateType ? GATE_TYPE_LABEL[gateType] : 'Hold gate'}
                  </span>
                </div>
                <p className="text-xs text-amber-200/70">
                  This order cannot leave its hold column until the gate is resolved.
                </p>
                {onRequestUnlock && (
                  <button
                    type="button"
                    onClick={() => onRequestUnlock(order)}
                    className="w-full rounded-md border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-500/30"
                  >
                    Resolve hold gate…
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-medium text-emerald-300">
                ✓ {inHoldStage ? 'Gate resolved' : 'No active hold gate'} — operational.
              </div>
            )}

            <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                Resolution history
              </p>
              <p className="text-xs text-zinc-500">
                No resolution notes loaded in this session. Gate lock/unlock events are
                recorded to the audit log on resolve.
              </p>
              <div className="mt-2 flex justify-between border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
                <span className="font-mono">Last updated</span>
                <span className="text-zinc-300">
                  {order.updated_at ? new Date(order.updated_at).toLocaleString() : '—'}
                </span>
              </div>
            </div>
          </section>
        </div>
      </aside>

      <CloseoutModal
        isOpen={closeoutOpen}
        onClose={() => setCloseoutOpen(false)}
        repairOrderId={order.id}
        financialStatus={{
          deductibleCollected,
          insuranceCleared,
          unreconciledPartsCount: items.filter((p) => p.status !== 'RECEIVED').length,
          pendingSupplementsCount,
        }}
        onExecuteCloseout={handleExecuteCloseout}
      />
    </div>
  );
}
