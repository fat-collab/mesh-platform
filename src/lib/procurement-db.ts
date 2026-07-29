/**
 * MESH Procurement — data access bridging RO parts (parts_line_items) to
 * purchase orders (purchase_orders / purchase_order_items).
 *
 * Aggregates un-ordered parts across active repair orders (the Parts Request
 * Queue), raises a PO for an RO's needed parts (flipping them NEEDED → ORDERED),
 * and lists active POs tied back to their RO. DB-first with a session-local
 * fallback, reusing ops-db for the parts side (which has its own fallback) and
 * MOCK_PARTS_BY_CLAIM for offline demo data.
 */
import { getSupabaseBrowserClient } from './supabase';
import { fetchBoardOrders } from './ops-data';
import { fetchPartsByClaim, updatePartStatus } from './ops-db';
import { MOCK_BOARD_ORDERS, MOCK_PARTS_BY_CLAIM } from './ops-mock';
import type { BoardOrder } from './board';
import type { PartsLineItem } from '@/components/ops/types';
import type {
  PartsRequestGroup,
  ProcurementPO,
  ProcurementPOItem,
  ProcurementPOStatus,
} from '@/components/inventory/procurement-types';

function genId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

// Session-local PO store (fallback + demo). Seeded with one active PO tied to a
// claim so the Active POs tab is demonstrable offline.
const localPOs: ProcurementPO[] = [
  {
    id: 'po-seed-0001',
    claimNumber: 'APX-2026-0001',
    supplierId: null,
    status: 'SENT',
    createdAt: '2026-07-26T15:00:00.000Z',
    items: [
      { id: 'poi-seed-1', partLineId: null, name: 'Front bumper absorber', quantity: 1, unitPrice: 0 },
    ],
  },
];

async function loadBoardOrders(): Promise<BoardOrder[]> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { orders, error } = await fetchBoardOrders(supabase);
    if (!error && orders.length > 0) return orders;
  } catch {
    /* fall through to sample */
  }
  return MOCK_BOARD_ORDERS;
}

/** Parts (from a claim) with a guaranteed id — synthesizes ids for mock rows. */
function partsForClaim(claim: string, dbItems: PartsLineItem[]): PartsLineItem[] {
  if (dbItems.length > 0) return dbItems;
  return (MOCK_PARTS_BY_CLAIM[claim] ?? []).map((p, i) => ({
    ...p,
    id: p.id ?? `mock:${claim}:${i}`,
  }));
}

/** Aggregates un-ordered (NEEDED) parts across active repair orders. */
export async function getPartsRequestQueue(): Promise<PartsRequestGroup[]> {
  const orders = await loadBoardOrders();
  const groups: PartsRequestGroup[] = [];

  for (const ro of orders) {
    const claim = ro.claim_number;
    if (!claim) continue;
    const { items } = await fetchPartsByClaim(claim);
    const parts = partsForClaim(claim, items).filter((p) => p.status === 'NEEDED');
    if (parts.length > 0) {
      groups.push({
        claimNumber: claim,
        customerName: ro.customer_name,
        vehicle: ro.vehicle,
        parts,
      });
    }
  }
  return groups;
}

interface PODbRow {
  id: string;
  claim_number: string | null;
  supplier_id: string | null;
  status: ProcurementPOStatus;
  created_at: string;
  purchase_order_items:
    | {
        id: string;
        part_line_id: string | null;
        quantity: number | null;
        unit_price: number | null;
        parts_line_items: { description: string | null; part_number: string | null } | null;
      }[]
    | null;
}

/** Lists purchase orders tied to a repair order (claim), newest first. */
export async function getActivePurchaseOrders(): Promise<ProcurementPO[]> {
  try {
    const supabase = getSupabaseBrowserClient();
    const res = await supabase
      .from('purchase_orders')
      .select(
        `id, claim_number, supplier_id, status, created_at,
         purchase_order_items ( id, part_line_id, quantity, unit_price,
           parts_line_items ( description, part_number ) )`,
      )
      .not('claim_number', 'is', null)
      .order('created_at', { ascending: false });
    const rows = res.data as unknown as PODbRow[] | null;
    if (!res.error && rows && rows.length > 0) {
      return rows.map((r) => ({
        id: r.id,
        claimNumber: r.claim_number ?? '',
        supplierId: r.supplier_id,
        status: r.status,
        createdAt: r.created_at,
        items: (r.purchase_order_items ?? []).map<ProcurementPOItem>((it) => ({
          id: it.id,
          partLineId: it.part_line_id,
          name: it.parts_line_items?.description ?? it.parts_line_items?.part_number ?? 'Part',
          quantity: it.quantity ?? 1,
          unitPrice: it.unit_price ?? 0,
        })),
      }));
    }
  } catch {
    /* fall through to local store */
  }
  return localPOs.map((po) => ({ ...po, items: po.items.map((i) => ({ ...i })) }));
}

/** Flips the given parts to ORDERED (mock rows in place, DB rows via ops-db). */
async function flipToOrdered(parts: PartsLineItem[]): Promise<void> {
  for (const p of parts) {
    const id = p.id ?? '';
    if (id.startsWith('mock:')) {
      const [, claim, idxStr] = id.split(':');
      const arr = MOCK_PARTS_BY_CLAIM[claim];
      const idx = Number(idxStr);
      if (arr && arr[idx]) arr[idx] = { ...arr[idx], status: 'ORDERED' };
    } else if (id) {
      await updatePartStatus(id, 'ORDERED');
    }
  }
}

/** Raises a PO for a repair order's needed parts, then marks them ORDERED. */
export async function generatePurchaseOrder(
  claimNumber: string,
  parts: PartsLineItem[],
): Promise<ProcurementPO> {
  const lines = parts.map((p) => ({
    partLineId: p.id ?? null,
    name: p.name,
    quantity: p.quantity ?? 1,
    unitPrice: p.unitCost ?? 0,
  }));

  let po: ProcurementPO | null = null;

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('purchase_orders')
      .insert({ claim_number: claimNumber, status: 'DRAFT' })
      .select('id, claim_number, supplier_id, status, created_at')
      .single();
    if (!error && data) {
      const row = data as {
        id: string;
        supplier_id: string | null;
        status: ProcurementPOStatus;
        created_at: string;
      };
      const itemRows = lines.map((l) => ({
        po_id: row.id,
        // Only real parts_line_items uuids satisfy the FK; mock ids stay null.
        part_line_id: l.partLineId && !l.partLineId.startsWith('mock:') ? l.partLineId : null,
        quantity: l.quantity,
        unit_price: l.unitPrice,
      }));
      const { data: inserted } = await supabase
        .from('purchase_order_items')
        .insert(itemRows)
        .select('id, part_line_id, quantity, unit_price');
      const insertedRows =
        (inserted as { id: string; part_line_id: string | null; quantity: number | null; unit_price: number | null }[] | null) ??
        [];
      po = {
        id: row.id,
        claimNumber,
        supplierId: row.supplier_id,
        status: row.status,
        createdAt: row.created_at,
        items: insertedRows.map<ProcurementPOItem>((r, i) => ({
          id: r.id,
          partLineId: r.part_line_id,
          name: lines[i]?.name ?? 'Part',
          quantity: r.quantity ?? 1,
          unitPrice: r.unit_price ?? 0,
        })),
      };
    }
  } catch {
    /* fall through to local store */
  }

  if (!po) {
    po = {
      id: genId('po'),
      claimNumber,
      supplierId: null,
      status: 'DRAFT',
      createdAt: new Date().toISOString(),
      items: lines.map<ProcurementPOItem>((l) => ({
        id: genId('poi'),
        partLineId: l.partLineId,
        name: l.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
    };
    localPOs.unshift(po);
  }

  await flipToOrdered(parts);
  return po;
}

/** Advances a PO's status (DRAFT → SENT → RECEIVED). */
export async function updatePurchaseOrderStatus(
  poId: string,
  status: ProcurementPOStatus,
): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('purchase_orders')
      .update({ status })
      .eq('id', poId)
      .select('id');
    if (!error && data && data.length > 0) return;
  } catch {
    /* fall through to local */
  }
  const po = localPOs.find((p) => p.id === poId);
  if (po) po.status = status;
}
