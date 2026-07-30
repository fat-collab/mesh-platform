/**
 * MESH Ops — repair-order labor & time-tracking data access layer.
 *
 * RO-scoped labor operations (one RO → many) backed by the repair_order_labor
 * table, with a session-local fallback so the drawer works when the table is
 * unavailable. Mirrors the DB-first + fallback pattern of parts-db.ts.
 */
import { getSupabaseBrowserClient } from './supabase';
import { executeDBOperation } from './db-guard';
import { isUuid } from './is-uuid';
import { fetchBoardOrders } from './ops-data';
import { MOCK_BOARD_ORDERS } from './ops-mock';
import type { BoardOrder } from './board';
import type {
  ActiveLaborLine,
  LaborStatus,
  RepairOrderLaborEntry,
} from '@/components/ops/ro-labor-types';

const TABLE = 'repair_order_labor';

interface LaborRow {
  id: string;
  repair_order_id: string;
  operation_name: string;
  technician_name: string;
  estimated_hours: number | null;
  actual_hours: number | null;
  status: LaborStatus;
  clocked_in_at: string | null;
  clocked_out_at: string | null;
  created_at: string;
}

function rowToEntry(row: LaborRow): RepairOrderLaborEntry {
  return {
    id: row.id,
    repairOrderId: row.repair_order_id,
    operationName: row.operation_name,
    technicianName: row.technician_name,
    estimatedHours: row.estimated_hours ?? 0,
    actualHours: row.actual_hours ?? 0,
    status: row.status,
    clockedInAt: row.clocked_in_at ?? undefined,
    clockedOutAt: row.clocked_out_at ?? undefined,
    createdAt: row.created_at,
  };
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `labor-${crypto.randomUUID()}`;
  }
  return `labor-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

// Session-local fallback store, keyed by repair order id. Pre-seeded for the
// default board RO ('mock-a6f1') so the drawer labor panel is populated in
// local/fallback mode.
const localLabor = new Map<string, RepairOrderLaborEntry[]>([
  [
    'mock-a6f1',
    [
      {
        id: 'seed-mock-a6f1-labor-1',
        repairOrderId: 'mock-a6f1',
        operationName: 'Front bumper R&I',
        technicianName: 'Dave K.',
        estimatedHours: 2.5,
        actualHours: 2.2,
        status: 'COMPLETED',
        clockedInAt: '2026-07-25T14:00:00.000Z',
        clockedOutAt: '2026-07-25T16:12:00.000Z',
        createdAt: '2026-07-25T13:55:00.000Z',
      },
      {
        id: 'seed-mock-a6f1-labor-2',
        repairOrderId: 'mock-a6f1',
        operationName: 'Hood dent PDR',
        technicianName: 'Marcus Vance',
        estimatedHours: 4.0,
        actualHours: 1.5,
        status: 'IN_PROGRESS',
        clockedInAt: '2026-07-27T15:30:00.000Z',
        createdAt: '2026-07-27T15:25:00.000Z',
      },
      {
        id: 'seed-mock-a6f1-labor-3',
        repairOrderId: 'mock-a6f1',
        operationName: 'LH headlamp aim & calibration',
        technicianName: 'Dave K.',
        estimatedHours: 1.0,
        actualHours: 0,
        status: 'PENDING',
        createdAt: '2026-07-27T15:26:00.000Z',
      },
    ],
  ],
]);

/** Loads all labor entries for a repair order (DB when available, else local). */
export async function getLaborEntries(
  repairOrderId: string,
): Promise<RepairOrderLaborEntry[]> {
  // A non-UUID id (sample/fallback board data) would make the query below
  // throw "invalid input syntax for type uuid" — not a real DB failure, so
  // skip the round-trip entirely and go straight to the local fallback.
  if (!isUuid(repairOrderId)) {
    return (localLabor.get(repairOrderId) ?? []).map((e) => ({ ...e }));
  }
  const supabase = getSupabaseBrowserClient();
  const result = await executeDBOperation<LaborRow[]>(
    'getLaborEntries',
    async () => {
      const res = await supabase
        .from(TABLE)
        .select('*')
        .eq('repair_order_id', repairOrderId)
        .order('created_at', { ascending: true });
      return { data: res.data as unknown as LaborRow[] | null, error: res.error };
    },
    [],
  );
  if (result.data && result.data.length > 0) {
    return result.data.map(rowToEntry);
  }
  return (localLabor.get(repairOrderId) ?? []).map((e) => ({ ...e }));
}

/**
 * Aggregates labor lines across all active repair orders (Technician Hub queue),
 * each enriched with its RO's claim / vehicle. Board list is DB-first (Supabase)
 * with the sample board as fallback; per-RO labor uses getLaborEntries.
 */
export async function getActiveLaborQueue(): Promise<ActiveLaborLine[]> {
  let orders: BoardOrder[] = MOCK_BOARD_ORDERS;
  try {
    const { orders: rows, error } = await fetchBoardOrders(getSupabaseBrowserClient());
    if (!error && rows.length > 0) orders = rows;
  } catch {
    /* fall through to sample board */
  }

  const lines: ActiveLaborLine[] = [];
  for (const ro of orders) {
    const entries = await getLaborEntries(ro.id);
    for (const entry of entries) {
      lines.push({
        entry,
        repairOrderId: ro.id,
        claimNumber: ro.claim_number,
        vehicle: ro.vehicle,
      });
    }
  }
  return lines;
}

export interface AddLaborInput {
  operationName: string;
  technicianName: string;
  estimatedHours: number;
  actualHours?: number;
  status?: LaborStatus;
}

/** Adds a labor operation to a repair order (DB when available, else local). */
export async function addLaborEntry(
  repairOrderId: string,
  input: AddLaborInput,
): Promise<RepairOrderLaborEntry> {
  const status: LaborStatus = input.status ?? 'PENDING';
  const actualHours = input.actualHours ?? 0;

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        repair_order_id: repairOrderId,
        operation_name: input.operationName.trim(),
        technician_name: input.technicianName.trim(),
        estimated_hours: input.estimatedHours,
        actual_hours: actualHours,
        status,
      })
      .select('*')
      .single();
    if (!error && data) {
      return rowToEntry(data as unknown as LaborRow);
    }
  } catch {
    /* fall through to local store */
  }

  const entry: RepairOrderLaborEntry = {
    id: genId(),
    repairOrderId,
    operationName: input.operationName.trim(),
    technicianName: input.technicianName.trim(),
    estimatedHours: input.estimatedHours,
    actualHours,
    status,
    createdAt: new Date().toISOString(),
  };
  const existing = localLabor.get(repairOrderId) ?? [];
  existing.push(entry);
  localLabor.set(repairOrderId, existing);
  return entry;
}

function findLocalEntry(entryId: string): RepairOrderLaborEntry | undefined {
  for (const list of localLabor.values()) {
    const entry = list.find((e) => e.id === entryId);
    if (entry) return entry;
  }
  return undefined;
}

/**
 * Clocks a technician in or out on a labor entry. Clock-in stamps clocked_in_at
 * and flips status to IN_PROGRESS; clock-out stamps clocked_out_at, marks the
 * op COMPLETED, and accrues the elapsed span into actual_hours.
 */
export async function toggleClock(
  entryId: string,
  action: 'IN' | 'OUT',
): Promise<void> {
  const now = new Date().toISOString();

  const patch: Record<string, unknown> =
    action === 'IN'
      ? { clocked_in_at: now, status: 'IN_PROGRESS' }
      : { clocked_out_at: now, status: 'COMPLETED' };

  // Compute accrued hours on clock-out from the DB-visible clock-in when we can;
  // for the local path we read the entry directly below.
  try {
    const supabase = getSupabaseBrowserClient();

    if (action === 'OUT') {
      const { data: existing } = await supabase
        .from(TABLE)
        .select('clocked_in_at, actual_hours')
        .eq('id', entryId)
        .maybeSingle();
      const row = existing as { clocked_in_at: string | null; actual_hours: number | null } | null;
      if (row?.clocked_in_at) {
        const elapsedH = (Date.parse(now) - Date.parse(row.clocked_in_at)) / 3_600_000;
        if (elapsedH > 0) patch.actual_hours = Number(((row.actual_hours ?? 0) + elapsedH).toFixed(2));
      }
    }

    const { data, error } = await supabase
      .from(TABLE)
      .update(patch)
      .eq('id', entryId)
      .select('id');
    if (!error && data && data.length > 0) return;
  } catch {
    /* fall through to local */
  }

  const entry = findLocalEntry(entryId);
  if (!entry) return;
  if (action === 'IN') {
    entry.clockedInAt = now;
    entry.status = 'IN_PROGRESS';
  } else {
    entry.clockedOutAt = now;
    entry.status = 'COMPLETED';
    if (entry.clockedInAt) {
      const elapsedH = (Date.parse(now) - Date.parse(entry.clockedInAt)) / 3_600_000;
      if (elapsedH > 0) entry.actualHours = Number((entry.actualHours + elapsedH).toFixed(2));
    }
  }
}

/** Sets the actual hours on a labor entry (DB when available, and always locally). */
export async function updateActualHours(entryId: string, hours: number): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(TABLE)
      .update({ actual_hours: hours })
      .eq('id', entryId)
      .select('id');
    if (!error && data && data.length > 0) return;
  } catch {
    /* fall through to local */
  }
  const entry = findLocalEntry(entryId);
  if (entry) entry.actualHours = hours;
}

/** Removes a labor entry (DB when available, and always locally). */
export async function removeLaborEntry(entryId: string): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    await supabase.from(TABLE).delete().eq('id', entryId);
  } catch {
    /* ignore — still prune the local store below */
  }
  for (const [roId, list] of localLabor) {
    const next = list.filter((e) => e.id !== entryId);
    if (next.length !== list.length) localLabor.set(roId, next);
  }
}
