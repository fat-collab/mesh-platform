/**
 * MESH Ops — repair-order staff assignment data access layer.
 *
 * Relational staffing (one RO → many staff, each in a role) backed by the
 * order_assignments table, with a session-local fallback so the floor staffing
 * still works when the table is unavailable (local dev / unmigrated DB). Mirrors
 * the DB-first + fallback pattern used across the other per-feature DALs.
 */
import { getSupabaseBrowserClient } from './supabase';
import { isUuid } from './is-uuid';
import { executeDBOperation } from './db-guard';
import type { OrderAssignment, StaffRole } from '@/components/ops/types';

const TABLE = 'order_assignments';

/** Raw order_assignments row (snake_case). */
interface AssignmentRow {
  id: string;
  repair_order_id: string;
  staff_id: string | null;
  staff_name: string;
  role: StaffRole;
  assigned_at: string;
}

function rowToAssignment(row: AssignmentRow): OrderAssignment {
  return {
    id: row.id,
    repairOrderId: row.repair_order_id,
    staffId: row.staff_id ?? '',
    staffName: row.staff_name,
    role: row.role,
    assignedAt: row.assigned_at,
  };
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `assign-${crypto.randomUUID()}`;
  }
  return `assign-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

// Session-local fallback store, keyed by repair order id. Pre-seeded with the
// default board RO ('mock-a6f1') so the Ops drawer staffing panel is populated
// immediately in local/fallback mode (before any DB-backed assignments exist).
const localAssignments = new Map<string, OrderAssignment[]>([
  [
    'mock-a6f1',
    [
      {
        id: 'seed-mock-a6f1-sales',
        repairOrderId: 'mock-a6f1',
        staffId: 'staff-avery',
        staffName: 'Avery Nguyen',
        role: 'SALES',
        assignedAt: '2026-07-24T16:31:35.922Z',
      },
      {
        id: 'seed-mock-a6f1-estimator',
        repairOrderId: 'mock-a6f1',
        staffId: 'staff-marcus-vance',
        staffName: 'Marcus Vance',
        role: 'ESTIMATOR',
        assignedAt: '2026-07-24T16:35:00.000Z',
      },
      {
        id: 'seed-mock-a6f1-body-tech',
        repairOrderId: 'mock-a6f1',
        staffId: 'staff-dave-k',
        staffName: 'Dave K.',
        role: 'BODY_TECH',
        assignedAt: '2026-07-24T16:40:00.000Z',
      },
    ],
  ],
]);

/** Loads all staff assignments for a repair order (DB when available, else local). */
export async function getAssignments(repairOrderId: string): Promise<OrderAssignment[]> {
  // A non-UUID id (sample/fallback board data) would make the query below
  // throw "invalid input syntax for type uuid" — not a real DB failure, so
  // skip the round-trip entirely and go straight to the local fallback.
  if (!isUuid(repairOrderId)) {
    return (localAssignments.get(repairOrderId) ?? []).map((a) => ({ ...a }));
  }
  const supabase = getSupabaseBrowserClient();
  const result = await executeDBOperation<AssignmentRow[]>(
    'getAssignments',
    async () => {
      const res = await supabase
        .from(TABLE)
        .select('*')
        .eq('repair_order_id', repairOrderId)
        .order('assigned_at', { ascending: true });
      return { data: res.data as unknown as AssignmentRow[] | null, error: res.error };
    },
    [],
  );
  if (result.data && result.data.length > 0) {
    return result.data.map(rowToAssignment);
  }
  return (localAssignments.get(repairOrderId) ?? []).map((a) => ({ ...a }));
}

export interface AssignStaffInput {
  staffId?: string | null;
  staffName: string;
  role: StaffRole;
}

/**
 * Assigns a staff member to a repair order in a role. Persists to the DB when
 * available, else records it in the session-local store. Returns the created
 * assignment (the DB row when persisted, otherwise the local record).
 */
export async function assignStaff(
  repairOrderId: string,
  input: AssignStaffInput,
): Promise<OrderAssignment> {
  const staffName = input.staffName.trim();
  const staffId = input.staffId?.trim() || null;

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        repair_order_id: repairOrderId,
        staff_id: staffId,
        staff_name: staffName,
        role: input.role,
      })
      .select('*')
      .single();
    if (!error && data) {
      return rowToAssignment(data as unknown as AssignmentRow);
    }
  } catch {
    /* fall through to local store */
  }

  const assignment: OrderAssignment = {
    id: genId(),
    repairOrderId,
    staffId: staffId ?? '',
    staffName,
    role: input.role,
    assignedAt: new Date().toISOString(),
  };
  const existing = localAssignments.get(repairOrderId) ?? [];
  existing.push(assignment);
  localAssignments.set(repairOrderId, existing);
  return assignment;
}

/** Removes a staff assignment (DB when available, and always locally). */
export async function removeAssignment(id: string): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    await supabase.from(TABLE).delete().eq('id', id);
  } catch {
    /* ignore — still prune the local store below */
  }
  for (const [roId, list] of localAssignments) {
    const next = list.filter((a) => a.id !== id);
    if (next.length !== list.length) localAssignments.set(roId, next);
  }
}
