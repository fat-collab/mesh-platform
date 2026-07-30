/**
 * MESH Ops — repair-order parts procurement data access layer.
 *
 * RO-scoped parts (one RO → many parts) backed by the repair_order_parts table,
 * with a session-local fallback so the drawer parts panel works when the table
 * is unavailable (local dev / unmigrated DB). Mirrors the DB-first + fallback
 * pattern of assignments-db.ts.
 */
import { getSupabaseBrowserClient } from './supabase';
import { isUuid } from './is-uuid';
import { executeDBOperation } from './db-guard';
import type { PartStatus, PartType, RepairOrderPart } from '@/components/ops/ro-parts-types';

const TABLE = 'repair_order_parts';

/** Raw repair_order_parts row (snake_case). */
interface PartRow {
  id: string;
  repair_order_id: string;
  part_name: string;
  part_number: string | null;
  vendor: string | null;
  part_type: PartType;
  status: PartStatus;
  cost: number | null;
  eta: string | null;
  created_at: string;
}

function rowToPart(row: PartRow): RepairOrderPart {
  return {
    id: row.id,
    repairOrderId: row.repair_order_id,
    partName: row.part_name,
    partNumber: row.part_number ?? undefined,
    vendor: row.vendor ?? undefined,
    partType: row.part_type,
    status: row.status,
    cost: row.cost ?? 0,
    eta: row.eta ?? undefined,
    createdAt: row.created_at,
  };
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `part-${crypto.randomUUID()}`;
  }
  return `part-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

// Session-local fallback store, keyed by repair order id. Pre-seeded with the
// default board RO ('mock-a6f1' — 2021 Ford F-150) so the drawer parts panel is
// populated immediately in local/fallback mode.
const localParts = new Map<string, RepairOrderPart[]>([
  [
    'mock-a6f1',
    [
      {
        id: 'seed-mock-a6f1-part-1',
        repairOrderId: 'mock-a6f1',
        partName: 'Front Bumper Cover',
        partNumber: 'FL3Z-17D957-AAPTM',
        vendor: 'Ford OEM',
        partType: 'OEM',
        status: 'ORDERED',
        cost: 612.4,
        eta: '2026-07-29',
        createdAt: '2026-07-24T16:32:00.000Z',
      },
      {
        id: 'seed-mock-a6f1-part-2',
        repairOrderId: 'mock-a6f1',
        partName: 'LH Headlamp Assembly',
        partNumber: 'JL34-13008-AH',
        vendor: 'LKQ',
        partType: 'SALVAGE',
        status: 'SHIPPED',
        cost: 285.0,
        eta: '2026-07-28',
        createdAt: '2026-07-24T16:33:00.000Z',
      },
      {
        id: 'seed-mock-a6f1-part-3',
        repairOrderId: 'mock-a6f1',
        partName: 'Grille Assembly',
        partNumber: 'FL3Z-8200-BA',
        vendor: 'Keystone',
        partType: 'AFTERMARKET',
        status: 'NEEDED',
        cost: 174.99,
        createdAt: '2026-07-24T16:34:00.000Z',
      },
      {
        id: 'seed-mock-a6f1-part-4',
        repairOrderId: 'mock-a6f1',
        partName: 'Hood Panel',
        partNumber: 'FL3Z-16612-A',
        vendor: 'Ford OEM',
        partType: 'OEM',
        status: 'RECEIVED',
        cost: 848.75,
        eta: '2026-07-25',
        createdAt: '2026-07-24T16:35:00.000Z',
      },
    ],
  ],
]);

/** Loads all parts for a repair order (DB when available, else local). */
export async function getParts(repairOrderId: string): Promise<RepairOrderPart[]> {
  // A non-UUID id (sample/fallback board data) would make the query below
  // throw "invalid input syntax for type uuid" — not a real DB failure, so
  // skip the round-trip entirely and go straight to the local fallback.
  if (!isUuid(repairOrderId)) {
    return (localParts.get(repairOrderId) ?? []).map((p) => ({ ...p }));
  }
  const supabase = getSupabaseBrowserClient();
  const result = await executeDBOperation<PartRow[]>(
    'getParts',
    async () => {
      const res = await supabase
        .from(TABLE)
        .select('*')
        .eq('repair_order_id', repairOrderId)
        .order('created_at', { ascending: true });
      return { data: res.data as unknown as PartRow[] | null, error: res.error };
    },
    [],
  );
  if (result.data && result.data.length > 0) {
    return result.data.map(rowToPart);
  }
  return (localParts.get(repairOrderId) ?? []).map((p) => ({ ...p }));
}

export interface AddPartInput {
  partName: string;
  partNumber?: string;
  vendor?: string;
  partType: PartType;
  status?: PartStatus;
  cost: number;
  eta?: string;
}

/**
 * Adds a part to a repair order. Persists to the DB when available, else records
 * it in the session-local store. Returns the created part (DB row when
 * persisted, otherwise the local record).
 */
export async function addPart(
  repairOrderId: string,
  input: AddPartInput,
): Promise<RepairOrderPart> {
  const status: PartStatus = input.status ?? 'NEEDED';
  const partNumber = input.partNumber?.trim() || null;
  const vendor = input.vendor?.trim() || null;
  const eta = input.eta?.trim() || null;

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        repair_order_id: repairOrderId,
        part_name: input.partName.trim(),
        part_number: partNumber,
        vendor,
        part_type: input.partType,
        status,
        cost: input.cost,
        eta,
      })
      .select('*')
      .single();
    if (!error && data) {
      return rowToPart(data as unknown as PartRow);
    }
  } catch {
    /* fall through to local store */
  }

  const part: RepairOrderPart = {
    id: genId(),
    repairOrderId,
    partName: input.partName.trim(),
    partNumber: partNumber ?? undefined,
    vendor: vendor ?? undefined,
    partType: input.partType,
    status,
    cost: input.cost,
    eta: eta ?? undefined,
    createdAt: new Date().toISOString(),
  };
  const existing = localParts.get(repairOrderId) ?? [];
  existing.push(part);
  localParts.set(repairOrderId, existing);
  return part;
}

/** Updates a part's procurement status (DB when available, and always locally). */
export async function updatePartStatus(id: string, status: PartStatus): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(TABLE)
      .update({ status })
      .eq('id', id)
      .select('id');
    if (!error && data && data.length > 0) return;
  } catch {
    /* fall through to local */
  }
  for (const list of localParts.values()) {
    const part = list.find((p) => p.id === id);
    if (part) {
      part.status = status;
      return;
    }
  }
}

/** Removes a part (DB when available, and always locally). */
export async function removePart(id: string): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    await supabase.from(TABLE).delete().eq('id', id);
  } catch {
    /* ignore — still prune the local store below */
  }
  for (const [roId, list] of localParts) {
    const next = list.filter((p) => p.id !== id);
    if (next.length !== list.length) localParts.set(roId, next);
  }
}
