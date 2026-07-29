/**
 * MESH — insurance supplement & photo audit data access.
 *
 * CRUD + lifecycle updates + aging tracking for carrier supplement claims.
 * DB-first (supplement_records with items jsonb) with a session-local fallback
 * seeded from mock, so the dashboard works before the table is applied.
 */
import { getSupabaseBrowserClient } from './supabase';
import { executeDBOperation } from './db-guard';
import { MOCK_SUPPLEMENTS } from './supplement-mock';
import {
  UNPAID_LIFECYCLE,
  type SupplementLifecycle,
  type SupplementRecord,
} from '@/components/supplements/types';

const TABLE = 'supplement_records';

interface SupplementRow {
  id: string;
  ro_id: string;
  customer_name: string;
  vehicle_info: string | null;
  insurance_carrier: string | null;
  claim_number: string | null;
  lifecycle_status: SupplementLifecycle;
  items: SupplementRecord['items'] | null;
  total_delta_amount: number | null;
  carrier_notes: string | null;
  adjuster_name: string | null;
  adjuster_phone: string | null;
  created_at: string;
}

function rowToRecord(row: SupplementRow): SupplementRecord {
  return {
    id: row.id,
    roId: row.ro_id,
    customerName: row.customer_name,
    vehicleInfo: row.vehicle_info ?? '',
    insuranceCarrier: row.insurance_carrier ?? '',
    claimNumber: row.claim_number ?? '',
    lifecycleStatus: row.lifecycle_status,
    items: row.items ?? [],
    totalDeltaAmount: row.total_delta_amount ?? 0,
    carrierNotes: row.carrier_notes ?? '',
    adjusterName: row.adjuster_name ?? undefined,
    adjusterPhone: row.adjuster_phone ?? undefined,
    createdAt: row.created_at,
  };
}

function recordToRow(rec: SupplementRecord) {
  return {
    id: rec.id,
    ro_id: rec.roId,
    customer_name: rec.customerName,
    vehicle_info: rec.vehicleInfo,
    insurance_carrier: rec.insuranceCarrier,
    claim_number: rec.claimNumber,
    lifecycle_status: rec.lifecycleStatus,
    items: rec.items,
    total_delta_amount: rec.totalDeltaAmount,
    carrier_notes: rec.carrierNotes,
    adjuster_name: rec.adjusterName ?? null,
    adjuster_phone: rec.adjusterPhone ?? null,
    created_at: rec.createdAt,
  };
}

export function genSupplementId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

/** Recomputes total delta (requested − original) across a record's items. */
export function computeTotalDelta(rec: SupplementRecord): number {
  const total = rec.items.reduce((s, i) => s + (i.requestedCost - i.originalCost), 0);
  return Math.round(total * 100) / 100;
}

function clone(rec: SupplementRecord): SupplementRecord {
  return { ...rec, items: rec.items.map((i) => ({ ...i })) };
}

// Session-local store — the fallback when the DB table is unavailable —
// seeded once from mock.
const localRecords: SupplementRecord[] = [];
let seeded = false;
function ensureSeed() {
  if (seeded) return;
  for (const rec of MOCK_SUPPLEMENTS) localRecords.push(clone(rec));
  seeded = true;
}

/** Lists all supplement records (newest first). */
export async function getSupplements(): Promise<SupplementRecord[]> {
  const supabase = getSupabaseBrowserClient();
  const result = await executeDBOperation<SupplementRow[]>(
    'getSupplements',
    async () => {
      const res = await supabase
        .from(TABLE)
        .select('*')
        .order('created_at', { ascending: false });
      return { data: res.data as unknown as SupplementRow[] | null, error: res.error };
    },
    [],
  );
  if (result.data && result.data.length > 0) {
    return result.data.map(rowToRecord);
  }
  ensureSeed();
  return [...localRecords]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(clone);
}

/**
 * Supplement records tied to one repair order — matched by RO id or, failing
 * that, its claim number (the shared key with repair_orders / parts_line_items).
 * This is the canonical per-RO supplement lookup used by the RO drawer,
 * invoicing, and analytics (superseding the retired RO-scoped supplements-db).
 */
export async function getSupplementsForRO(
  roId: string,
  claimNumber?: string,
): Promise<SupplementRecord[]> {
  const all = await getSupplements();
  return all.filter(
    (r) => r.roId === roId || (!!claimNumber && r.claimNumber === claimNumber),
  );
}

/**
 * Carrier-approved supplement dollars across records — the approved delta
 * (records in APPROVED_PENDING_PAYMENT or PAID). Used by invoicing/analytics as
 * the single "approved supplements" figure.
 */
export function approvedSupplementTotal(records: SupplementRecord[]): number {
  const total = records
    .filter(
      (r) =>
        r.lifecycleStatus === 'APPROVED_PENDING_PAYMENT' || r.lifecycleStatus === 'PAID',
    )
    .reduce((s, r) => s + r.totalDeltaAmount, 0);
  return Math.round(total * 100) / 100;
}

/** Creates or updates a supplement (upsert). Total delta is recomputed. */
export async function saveSupplement(record: SupplementRecord): Promise<SupplementRecord> {
  const rec: SupplementRecord = { ...record, totalDeltaAmount: computeTotalDelta(record) };
  try {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from(TABLE).upsert(recordToRow(rec));
    if (!error) return rec;
  } catch {
    /* fall through to local */
  }
  ensureSeed();
  const idx = localRecords.findIndex((r) => r.id === rec.id);
  if (idx >= 0) localRecords[idx] = clone(rec);
  else localRecords.push(clone(rec));
  return rec;
}

/** Deletes a supplement record. */
export async function deleteSupplement(id: string): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.from(TABLE).delete().eq('id', id).select('id');
    if (!error && data && data.length > 0) return;
  } catch {
    /* fall through to local */
  }
  ensureSeed();
  const idx = localRecords.findIndex((r) => r.id === id);
  if (idx >= 0) localRecords.splice(idx, 1);
}

/** Advances/sets a supplement's payment lifecycle status. */
export async function updateSupplementStatus(
  id: string,
  lifecycleStatus: SupplementLifecycle,
): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(TABLE)
      .update({ lifecycle_status: lifecycleStatus })
      .eq('id', id)
      .select('id');
    if (!error && data && data.length > 0) return;
  } catch {
    /* fall through to local */
  }
  ensureSeed();
  const rec = localRecords.find((r) => r.id === id);
  if (rec) rec.lifecycleStatus = lifecycleStatus;
}

/** Whole days a record has been outstanding since creation. */
export function supplementAgingDays(createdAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 86_400_000));
}

/** Submitted/unpaid records older than the threshold (aging alerts). */
export async function getAgingSupplements(thresholdDays = 14): Promise<SupplementRecord[]> {
  const all = await getSupplements();
  const now = Date.now();
  return all.filter(
    (r) =>
      UNPAID_LIFECYCLE.includes(r.lifecycleStatus) &&
      supplementAgingDays(r.createdAt, now) >= thresholdDays,
  );
}
