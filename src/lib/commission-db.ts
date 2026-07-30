/**
 * MESH Sales — Commission reporting & executive override layer.
 *
 * Reads the SALES-role legs of the existing payout_splits ledger (the same
 * 50/10/40 Stripe Connect split table the Payouts cockpit uses) and joins the
 * accountable rep from order_assignments (role SALES) — this app tracks staff
 * identity as free-text names/ids (LeadOwnerChip, assignStaff), not resolvable
 * user accounts, so that join is the correct source of the rep's display name
 * rather than payout_splits.tech_user_id.
 *
 * commission_overrides is the "dynamic configuration layer": an executive-only
 * override of a split's effective tech_split_pct, scoped to either a specific
 * rep (userId) or a specific RO deal (roId) — RO-level takes precedence over
 * rep-level when both exist. This is a reporting/override view, not a parallel
 * payroll engine: overrides never mutate the underlying payout_splits row,
 * they only change what's displayed as the effective commission until a real
 * payroll adjustment is made.
 *
 * DB-first with a session-local fallback, mirroring every other DAL in this
 * app so the panel always renders.
 */
import { getSupabaseBrowserClient } from './supabase';
import { getAssignments } from './assignments-db';
import type { PayoutStatus } from './database.types';

function genId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

export interface CommissionEntry {
  splitId: string;
  roId: string;
  claimNumber: string;
  customerName: string | null;
  repName: string | null;
  repStaffId: string | null;
  grossAmount: number;
  /** The tech_split_pct stored on the payout_splits row. */
  basePct: number;
  /** basePct, unless an override applies. */
  effectivePct: number;
  netPayout: number;
  status: PayoutStatus;
  overridden: boolean;
}

export interface CommissionOverrideRow {
  id: string;
  userId: string | null;
  roId: string | null;
  overridePct: number;
  setBy: string | null;
  createdAt: string;
}

// --- session-local fallback --------------------------------------------------

interface LocalSalesSplit {
  id: string;
  roId: string;
  claimNumber: string;
  customerName: string | null;
  grossAmount: number;
  basePct: number;
  status: PayoutStatus;
}

// Anchored to 'mock-a6f1', the shared demo RO seeded across ops/procurement
// fallback data, so a SALES rep assignment on it is already demonstrable.
const SAMPLE_SALES_SPLITS: LocalSalesSplit[] = [
  {
    id: 'split-seed-sales-0001',
    roId: 'mock-a6f1',
    claimNumber: 'APX-2026-0001',
    customerName: 'Dana Whitfield',
    grossAmount: 5000,
    basePct: 10,
    status: 'PENDING',
  },
];

const localOverrides: CommissionOverrideRow[] = [];

function resolveOverride(
  overrides: CommissionOverrideRow[],
  roId: string,
  userId: string | null,
): CommissionOverrideRow | null {
  const roOverride = overrides.find((o) => o.roId === roId);
  if (roOverride) return roOverride;
  if (userId) {
    const userOverride = overrides.find((o) => o.userId === userId);
    if (userOverride) return userOverride;
  }
  return null;
}

/** Loads all commission overrides (DB when available, else local). Reporting
 *  is broadly readable; only writes are executive-gated. */
export async function getCommissionOverrides(): Promise<CommissionOverrideRow[]> {
  interface RawOverride {
    id: string;
    user_id: string | null;
    ro_id: string | null;
    override_pct: number;
    set_by: string | null;
    created_at: string;
  }
  try {
    const supabase = getSupabaseBrowserClient();
    const res = await supabase
      .from('commission_overrides')
      .select('id, user_id, ro_id, override_pct, set_by, created_at')
      .order('created_at', { ascending: false });
    const rows = res.data as unknown as RawOverride[] | null;
    if (!res.error && rows) {
      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        roId: r.ro_id,
        overridePct: r.override_pct,
        setBy: r.set_by,
        createdAt: r.created_at,
      }));
    }
  } catch {
    /* fall through to local */
  }
  return localOverrides.map((o) => ({ ...o }));
}

export interface SetCommissionOverrideInput {
  userId?: string | null;
  roId?: string | null;
  overridePct: number;
  setBy?: string | null;
}

/**
 * Sets (inserts) an executive commission override for a rep or an RO deal.
 * Enforces the same scope requirement as the DB check constraint in both the
 * DB and local-fallback paths, so it holds regardless of connectivity.
 */
export async function setCommissionOverride(input: SetCommissionOverrideInput): Promise<void> {
  const userId = input.userId?.trim() || null;
  const roId = input.roId?.trim() || null;
  if (!userId && !roId) {
    throw new Error('A commission override must target a specific rep or a specific RO deal.');
  }
  if (!Number.isFinite(input.overridePct) || input.overridePct < 0 || input.overridePct > 100) {
    throw new Error('Commission override percentage must be between 0 and 100.');
  }

  try {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from('commission_overrides').insert({
      user_id: userId,
      ro_id: roId,
      override_pct: input.overridePct,
      set_by: input.setBy ?? null,
      split_role: 'SALES',
    });
    if (!error) return;
  } catch {
    /* fall through to local */
  }

  localOverrides.unshift({
    id: genId('cov'),
    userId,
    roId,
    overridePct: input.overridePct,
    setBy: input.setBy ?? null,
    createdAt: new Date().toISOString(),
  });
}

/** Loads the SALES-role commission ledger, with overrides applied. */
export async function getCommissionLedger(): Promise<CommissionEntry[]> {
  const overrides = await getCommissionOverrides();

  interface RawSalesSplit {
    id: string;
    ro_id: string;
    tech_split_pct: number;
    gross_amount: number;
    net_payout: number | null;
    status: PayoutStatus;
    repair_orders: { claim_number: string | null; customer_name: string | null } | null;
  }

  try {
    const supabase = getSupabaseBrowserClient();
    const res = await supabase
      .from('payout_splits')
      .select(
        `id, ro_id, tech_split_pct, gross_amount, net_payout, status,
         repair_orders ( claim_number, customer_name )`,
      )
      .eq('split_role', 'SALES')
      .order('created_at', { ascending: false });
    const rows = res.data as unknown as RawSalesSplit[] | null;
    if (!res.error && rows && rows.length > 0) {
      const entries: CommissionEntry[] = [];
      for (const r of rows) {
        const assignments = await getAssignments(r.ro_id);
        const rep = assignments.find((a) => a.role === 'SALES') ?? null;
        const override = resolveOverride(overrides, r.ro_id, rep?.staffId || null);
        const effectivePct = override?.overridePct ?? r.tech_split_pct;
        const netPayout = override
          ? (r.gross_amount * effectivePct) / 100
          : (r.net_payout ?? (r.gross_amount * r.tech_split_pct) / 100);
        entries.push({
          splitId: r.id,
          roId: r.ro_id,
          claimNumber: r.repair_orders?.claim_number ?? r.ro_id,
          customerName: r.repair_orders?.customer_name ?? null,
          repName: rep?.staffName ?? null,
          repStaffId: rep?.staffId || null,
          grossAmount: r.gross_amount,
          basePct: r.tech_split_pct,
          effectivePct,
          netPayout,
          status: r.status,
          overridden: Boolean(override),
        });
      }
      return entries;
    }
  } catch {
    /* fall through to local */
  }

  const entries: CommissionEntry[] = [];
  for (const s of SAMPLE_SALES_SPLITS) {
    const assignments = await getAssignments(s.roId);
    const rep = assignments.find((a) => a.role === 'SALES') ?? null;
    const override = resolveOverride(overrides, s.roId, rep?.staffId || null);
    const effectivePct = override?.overridePct ?? s.basePct;
    entries.push({
      splitId: s.id,
      roId: s.roId,
      claimNumber: s.claimNumber,
      customerName: s.customerName,
      repName: rep?.staffName ?? null,
      repStaffId: rep?.staffId || null,
      grossAmount: s.grossAmount,
      basePct: s.basePct,
      effectivePct,
      netPayout: (s.grossAmount * effectivePct) / 100,
      status: s.status,
      overridden: Boolean(override),
    });
  }
  return entries;
}
