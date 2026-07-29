/**
 * MESH Platform — Ops Cockpit data access.
 *
 * Fetch + mutation helpers for the repair board, backed by the browser Supabase
 * client (RLS-enforced). Reads join vehicles, locations, and the latest total-
 * loss audit for the risk-score badge.
 */
import type { RoStage } from './database.types';
import type { MeshSupabaseClient } from './supabase';
import type { BoardOrder } from './board';
import { executeDBOperation } from './db-guard';

/** Shape of the nested select below (typed by hand to avoid generic churn). */
interface RawRepairOrderRow {
  id: string;
  claim_number: string | null;
  customer_name: string | null;
  stage: RoStage;
  hold_gate_active: boolean;
  target_delivery_date: string | null;
  created_at: string;
  updated_at: string;
  vehicles: {
    vin: string | null;
    year: number | null;
    make: string | null;
    model: string | null;
    paint_code: string | null;
  } | null;
  locations: { name: string | null } | null;
  total_loss_audits: { risk_score: number | null; created_at: string }[] | null;
}

function formatVehicle(v: RawRepairOrderRow['vehicles']): string {
  if (!v) return 'Unknown vehicle';
  const parts = [v.year, v.make, v.model].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Unknown vehicle';
}

function latestRiskScore(audits: RawRepairOrderRow['total_loss_audits']): number | null {
  if (!audits || audits.length === 0) return null;
  const latest = [...audits].sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  )[0];
  return latest?.risk_score ?? null;
}

export function mapRowToBoardOrder(row: RawRepairOrderRow): BoardOrder {
  return {
    id: row.id,
    claim_number: row.claim_number,
    customer_name: row.customer_name,
    vehicle: formatVehicle(row.vehicles),
    vin: row.vehicles?.vin ?? null,
    location: row.locations?.name ?? '—',
    stage: row.stage,
    hold_gate_active: row.hold_gate_active,
    risk_score: latestRiskScore(row.total_loss_audits),
    targetDeliveryDate: row.target_delivery_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface FetchResult {
  orders: BoardOrder[];
  error: string | null;
}

/** Loads all repair orders visible to the current session. */
export async function fetchBoardOrders(
  supabase: MeshSupabaseClient,
): Promise<FetchResult> {
  // Guarded read: centralizes logging, throws in production, and returns the
  // dev fallback (empty rows) locally so the board still renders.
  const result = await executeDBOperation<RawRepairOrderRow[]>(
    'fetchBoardOrders',
    async () => {
      const res = await supabase
        .from('repair_orders')
        .select(
          `id, claim_number, customer_name, stage, hold_gate_active, target_delivery_date, created_at, updated_at,
           vehicles ( vin, year, make, model, paint_code ),
           locations ( name ),
           total_loss_audits ( risk_score, created_at )`,
        )
        .order('created_at', { ascending: true });
      return { data: res.data as unknown as RawRepairOrderRow[] | null, error: res.error };
    },
    [],
  );

  const rows = result.data ?? [];
  return { orders: rows.map(mapRowToBoardOrder), error: result.error };
}

/**
 * Persists a stage change from a drag-and-drop transition.
 *
 * `updated_at` is sent explicitly so the payload mirrors the optimistic local
 * state; the DB's `trg_repair_orders_updated_at` trigger will re-stamp it to
 * server `now()` regardless. The `trg_repair_orders_hold_gate` trigger
 * re-derives `hold_gate_active` from the new stage, so it is not sent here.
 */
export async function persistStage(
  supabase: MeshSupabaseClient,
  id: string,
  stage: RoStage,
  updatedAt: string = new Date().toISOString(),
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('repair_orders')
    .update({ stage, updated_at: updatedAt })
    .eq('id', id);
  return { error: error?.message ?? null };
}

/**
 * Persists an edit to a repair order's core fields (customer / claim / stage).
 * Only the provided keys are written; `updated_at` is stamped alongside.
 */
export async function persistRepairOrder(
  supabase: MeshSupabaseClient,
  id: string,
  patch: {
    customer_name?: string | null;
    claim_number?: string | null;
    stage?: RoStage;
    target_delivery_date?: string | null;
  },
  updatedAt: string = new Date().toISOString(),
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('repair_orders')
    .update({ ...patch, updated_at: updatedAt })
    .eq('id', id);
  return { error: error?.message ?? null };
}

/**
 * Resolves a hold gate: clears hold_gate_active on the order and appends the
 * resolution (reason + timestamp) to the gate's audit history.
 *
 * The `repair_orders` write is the critical one — it drives the lock badge and
 * drag-disable — so its failure is surfaced to the caller for optimistic
 * revert. Closing the `hold_gate_logs` row is a best-effort audit write: a
 * failure there (e.g. the schema has not yet gained `resolution_reason`) must
 * NOT roll back an unlock the operator already performed, so it is swallowed
 * with a warning rather than returned as an error.
 */
export async function persistUnlock(
  supabase: MeshSupabaseClient,
  id: string,
  reason?: string,
  resolvedAt: string = new Date().toISOString(),
): Promise<{ error: string | null }> {
  const { error: roError } = await supabase
    .from('repair_orders')
    .update({ hold_gate_active: false, updated_at: resolvedAt })
    .eq('id', id);
  if (roError) return { error: roError.message };

  const { error: logError } = await supabase
    .from('hold_gate_logs')
    .update({ unlocked_at: resolvedAt, resolution_reason: reason ?? null })
    .eq('ro_id', id)
    .is('unlocked_at', null);

  if (logError) {
    console.warn(
      `[ops] gate released for RO ${id} but audit log update failed: ${logError.message}`,
    );
  }
  return { error: null };
}
