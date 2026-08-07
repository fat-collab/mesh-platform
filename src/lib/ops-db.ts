/**
 * MESH Ops — parts & line-item persistence (Supabase).
 *
 * Data-access helpers for the RO Detail drawer's Parts Operations panel:
 * fetch by claim number, mark received (with invoice capture), and flag a
 * discrepancy. Backed by the browser Supabase client; callers fall back to
 * local/mock state when the table isn't initialized yet (see RODetailDrawer).
 */
import { getSupabaseBrowserClient } from './supabase';
import { executeDBOperation } from './db-guard';
import { getCurrentProfile } from './auth';
import { assertPersistableDocumentUrl, genUuid, uploadDocumentFile } from '@/lib/storage-upload';
import {
  categoryForGateType,
  type AuditLogEntry,
  type DiscrepancyReason,
  type PartSourcingTier,
  type PartStatus,
  type PartsLineItem,
  type SupplementPackage,
} from '@/components/ops/types';
import { MOCK_SUPPLEMENTS } from './ops-mock';
import type { HoldGateType } from './database.types';

const TABLE = 'parts_line_items';

/** Raw parts_line_items row (snake_case, as stored). */
interface PartRow {
  id: string;
  claim_number: string | null;
  part_number: string | null;
  description: string | null;
  vendor_name: string | null;
  quantity: number | null;
  unit_cost: number | null;
  status: PartStatus;
  sourcing_tier: PartSourcingTier | null;
  capa_certified: boolean | null;
  invoice_number: string | null;
  invoice_url: string | null;
  received_at: string | null;
  discrepancy_reason: DiscrepancyReason | null;
  discrepancy_notes: string | null;
  return_rma_number: string | null;
  replacement_expected_date: string | null;
  created_at: string;
}

function rowToLineItem(row: PartRow): PartsLineItem {
  return {
    id: row.id,
    name: row.description ?? row.part_number ?? 'Part',
    status: row.status,
    sourcingTier: row.sourcing_tier ?? 'OEM',
    capaCertified: row.capa_certified ?? undefined,
    partNumber: row.part_number,
    vendorName: row.vendor_name,
    quantity: row.quantity,
    unitCost: row.unit_cost,
    leadTimeDays: null,
    invoiceNumber: row.invoice_number,
    invoiceUrl: row.invoice_url,
    discrepancyReason: row.discrepancy_reason,
    discrepancyNotes: row.discrepancy_notes,
    returnRmaNumber: row.return_rma_number,
    replacementExpectedDate: row.replacement_expected_date,
  };
}

export interface PartsFetchResult {
  items: PartsLineItem[];
  error: string | null;
}

/** Loads parts line items for a claim, ordered by creation. */
export async function fetchPartsByClaim(
  claimNumber: string,
): Promise<PartsFetchResult> {
  const supabase = getSupabaseBrowserClient();
  const result = await executeDBOperation<PartRow[]>(
    'fetchPartsByClaim',
    async () => {
      const res = await supabase
        .from(TABLE)
        .select('*')
        .eq('claim_number', claimNumber)
        .order('created_at', { ascending: true });
      return { data: res.data as unknown as PartRow[] | null, error: res.error };
    },
    [],
  );

  const rows = result.data ?? [];
  return { items: rows.map(rowToLineItem), error: result.error };
}

let localSeq = 0;
function localId(claimNumber: string): string {
  localSeq += 1;
  return `local-${claimNumber}-${localSeq}`;
}

/**
 * Bulk-imports estimate line items for a claim. Inserts into parts_line_items
 * when available (returning the persisted rows with ids); on any DB error or
 * unseeded/offline table, falls back to in-memory items with local ids so the
 * drawer can still render + edit them.
 */
export async function importEstimateLineItems(
  claimNumber: string,
  items: Omit<PartsLineItem, 'id'>[],
): Promise<PartsLineItem[]> {
  if (items.length === 0) return [];

  const rows = items.map((item) => ({
    claim_number: claimNumber,
    part_number: item.partNumber ?? null,
    description: item.name,
    vendor_name: item.vendorName ?? null,
    quantity: item.quantity ?? null,
    unit_cost: item.unitCost ?? null,
    sourcing_tier: item.sourcingTier,
    capa_certified: item.capaCertified ?? null,
    status: 'NEEDED',
  }));

  const localFallback = () =>
    items.map((item) => ({ ...item, id: localId(claimNumber) }));

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.from(TABLE).insert(rows).select('*');
    if (error || !data) return localFallback();
    return (data as unknown as PartRow[]).map(rowToLineItem);
  } catch {
    return localFallback();
  }
}

/**
 * Updates a single line item's status. Persists to parts_line_items when
 * available; local/optimistic ids and offline/unseeded tables are handled
 * gracefully (the caller keeps its optimistic local state).
 */
export async function updatePartStatus(
  partId: string,
  status: PartStatus,
): Promise<void> {
  // Local/optimistic ids never correspond to a DB row.
  if (partId.startsWith('local-') || partId.startsWith('tmp-')) return;
  try {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from(TABLE).update({ status }).eq('id', partId);
    if (error) {
      console.warn(`[ops] part status update failed for ${partId}: ${error.message}`);
    }
  } catch (err) {
    console.warn('[ops] part status update threw; keeping local state:', err);
  }
}

export interface MarkReceivedInput {
  invoiceNumber?: string | null;
  invoiceUrl?: string | null;
  receivedAt?: string;
}

/**
 * Uploads a part's invoice file to the 'documents' bucket, at the
 * {org}/repair-orders/{ro_id}/invoice-{uuid}.{ext} path segment reserved in
 * 20260806000000. Returns the resulting path, or null on failure — never
 * throws, matching every other write in this file. parts_line_items has no
 * organization_id column (it's keyed by claim_number, not org), so the org
 * is resolved client-side — same reasoning as rental-db.ts's
 * uploadLoanDriverDocument: the documents bucket's write RLS keys off the
 * first path segment matching the current session's org, so the path needs
 * one from somewhere.
 */
export async function uploadPartInvoice(roId: string, file: File): Promise<string | null> {
  try {
    const supabase = getSupabaseBrowserClient();
    const profile = await getCurrentProfile(supabase);
    if (!profile?.organizationId) return null;
    const pathWithoutExt = `${profile.organizationId}/repair-orders/${roId}/invoice-${genUuid()}`;
    const uploaded = await uploadDocumentFile(pathWithoutExt, file);
    return uploaded?.path ?? null;
  } catch (err) {
    console.warn(`[ops-db] uploadPartInvoice failed for RO ${roId}:`, err);
    return null;
  }
}

/** Marks a line item RECEIVED, capturing invoice details and clearing any
 *  prior discrepancy. Rejects a blob:/data: invoiceUrl outright — see
 *  assertPersistableDocumentUrl — rather than storing a reference that's
 *  already dead by the time anyone reads it back. */
export async function markPartReceived(
  id: string,
  input: MarkReceivedInput,
): Promise<{ error: string | null }> {
  assertPersistableDocumentUrl(input.invoiceUrl);
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from(TABLE)
    .update({
      status: 'RECEIVED',
      invoice_number: input.invoiceNumber ?? null,
      invoice_url: input.invoiceUrl ?? null,
      received_at: input.receivedAt ?? new Date().toISOString(),
      discrepancy_reason: null,
      discrepancy_notes: null,
      return_rma_number: null,
      replacement_expected_date: null,
    })
    .eq('id', id);
  return { error: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Audit history / hold activity stream (hold_gate_logs)
// ---------------------------------------------------------------------------

const HOLD_LOGS_TABLE = 'hold_gate_logs';

/** Raw hold_gate_logs row with joined claim / VIN / operator. */
interface HoldLogRow {
  id: string;
  gate_type: HoldGateType | null;
  locked_at: string;
  unlocked_at: string | null;
  resolution_reason: string | null;
  resolved_by: string | null;
  repair_orders: {
    claim_number: string | null;
    vehicles: { vin: string | null } | null;
  } | null;
  users: { full_name: string | null; role: string | null } | null;
}

function rowToAuditEntry(row: HoldLogRow): AuditLogEntry {
  return {
    id: row.id,
    claimNumber: row.repair_orders?.claim_number ?? null,
    vin: row.repair_orders?.vehicles?.vin ?? null,
    category: categoryForGateType(row.gate_type),
    operator: row.users?.full_name ?? row.users?.role ?? 'System',
    // hold_gate_logs models place/resolve; overrides surface via mock only.
    action: row.unlocked_at ? 'RESOLVED' : 'PLACED_ON_HOLD',
    reason: row.resolution_reason,
    lockedAt: row.locked_at,
    resolvedAt: row.unlocked_at,
  };
}

export interface AuditLogFetchResult {
  entries: AuditLogEntry[];
  error: string | null;
}

/** Pulls hold gate logs (most recent first) with claim, VIN, and operator. */
export async function fetchHoldGateLogs(): Promise<AuditLogFetchResult> {
  const supabase = getSupabaseBrowserClient();
  const result = await executeDBOperation<HoldLogRow[]>(
    'fetchHoldGateLogs',
    async () => {
      const res = await supabase
        .from(HOLD_LOGS_TABLE)
        .select(
          `id, gate_type, locked_at, unlocked_at, resolution_reason, resolved_by,
           repair_orders ( claim_number, vehicles ( vin ) ),
           users ( full_name, role )`,
        )
        .order('locked_at', { ascending: false });
      return { data: res.data as unknown as HoldLogRow[] | null, error: res.error };
    },
    [],
  );

  const rows = result.data ?? [];
  return { entries: rows.map(rowToAuditEntry), error: result.error };
}

export interface FlagDiscrepancyInput {
  reason: DiscrepancyReason;
  rmaNumber?: string | null;
  replacementDate?: string | null;
  notes?: string | null;
}

/** Flags a line item as a DISCREPANCY with reason, RMA #, and replacement ETA. */
export async function flagPartDiscrepancy(
  id: string,
  input: FlagDiscrepancyInput,
): Promise<{ error: string | null }> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from(TABLE)
    .update({
      status: 'DISCREPANCY',
      discrepancy_reason: input.reason,
      return_rma_number: input.rmaNumber ?? null,
      replacement_expected_date: input.replacementDate ?? null,
      discrepancy_notes: input.notes ?? null,
    })
    .eq('id', id);
  return { error: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Internal scoping & supplements
// ---------------------------------------------------------------------------

const SUPPLEMENTS_TABLE = 'supplement_packages';

interface SupplementRow {
  id: string;
  claim_number: string;
  status: SupplementPackage['status'];
  items: SupplementPackage['items'] | null;
  total_delta: number | null;
  adjuster_notes: string | null;
  created_at: string;
}

function rowToSupplement(row: SupplementRow): SupplementPackage {
  return {
    id: row.id,
    claimNumber: row.claim_number,
    status: row.status,
    items: row.items ?? [],
    totalDelta: row.total_delta ?? 0,
    adjusterNotes: row.adjuster_notes ?? '',
    createdAt: row.created_at,
  };
}

function clonePackage(pkg: SupplementPackage): SupplementPackage {
  return { ...pkg, items: pkg.items.map((it) => ({ ...it })) };
}

// Session-local supplement store — the fallback when the DB table is
// unavailable — seeded once from the mock data.
const localSupplements: Record<string, SupplementPackage[]> = {};
let supplementsSeeded = false;
function ensureSupplementSeed() {
  if (supplementsSeeded) return;
  for (const [claim, pkgs] of Object.entries(MOCK_SUPPLEMENTS)) {
    localSupplements[claim] = pkgs.map(clonePackage);
  }
  supplementsSeeded = true;
}

/** Loads supplement packages for a claim (DB when seeded, else local/mock). */
export async function getSupplementsForClaim(
  claimNumber: string,
): Promise<SupplementPackage[]> {
  const supabase = getSupabaseBrowserClient();
  const result = await executeDBOperation<SupplementRow[]>(
    'getSupplementsForClaim',
    async () => {
      const res = await supabase
        .from(SUPPLEMENTS_TABLE)
        .select('*')
        .eq('claim_number', claimNumber)
        .order('created_at', { ascending: true });
      return { data: res.data as unknown as SupplementRow[] | null, error: res.error };
    },
    [],
  );

  if (result.data && result.data.length > 0) {
    return result.data.map(rowToSupplement);
  }

  ensureSupplementSeed();
  return (localSupplements[claimNumber] ?? []).map(clonePackage);
}

/** Persists a supplement package (upsert to DB, else session-local store). */
export async function saveSupplementPackage(pkg: SupplementPackage): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from(SUPPLEMENTS_TABLE).upsert({
      id: pkg.id,
      claim_number: pkg.claimNumber,
      status: pkg.status,
      items: pkg.items,
      total_delta: pkg.totalDelta,
      adjuster_notes: pkg.adjusterNotes,
      created_at: pkg.createdAt,
    });
    if (!error) return;
  } catch {
    /* fall through to local */
  }
  ensureSupplementSeed();
  const list =
    localSupplements[pkg.claimNumber] ?? (localSupplements[pkg.claimNumber] = []);
  const idx = list.findIndex((p) => p.id === pkg.id);
  if (idx >= 0) list[idx] = clonePackage(pkg);
  else list.push(clonePackage(pkg));
}
