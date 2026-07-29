/**
 * MESH Inventory — vendor & parts inventory data access layer.
 *
 * Shop catalog, supplier price matrix, and purchase orders. DB-first with a
 * robust session-local fallback (mock suppliers / catalog / active POs) so the
 * inventory console is demonstrable without the tables. Mirrors the DB-first +
 * fallback pattern of the other DALs.
 */
import { getSupabaseBrowserClient } from './supabase';
import { executeDBOperation } from './db-guard';
import type {
  CatalogItem,
  POItem,
  PurchaseOrder,
  Supplier,
  SupplierPartMatrix,
} from '@/components/inventory/inventory-types';

function genId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

// --- local fallback seed -----------------------------------------------------
const localSuppliers: Supplier[] = [
  { id: 'sup-keystone', name: 'Keystone Automotive', contact: 'orders@keystone.example', leadTimeDays: 2 },
  { id: 'sup-lkq', name: 'LKQ Corporation', contact: 'wholesale@lkq.example', leadTimeDays: 3 },
  { id: 'sup-ford', name: 'Ford OEM Parts', contact: 'parts@forddealer.example', leadTimeDays: 5 },
];

const localCatalog: CatalogItem[] = [
  { id: 'cat-1', sku: 'BUMP-F150', name: 'Front Bumper Cover', category: 'Body', minStock: 2, currentStock: 1 },
  { id: 'cat-2', sku: 'HL-F150-L', name: 'LH Headlamp Assembly', category: 'Electrical', minStock: 2, currentStock: 4 },
  { id: 'cat-3', sku: 'GRILLE-F150', name: 'Grille Assembly', category: 'Body', minStock: 1, currentStock: 0 },
  { id: 'cat-4', sku: 'HOOD-F150', name: 'Hood Panel', category: 'Body', minStock: 1, currentStock: 2 },
  { id: 'cat-5', sku: 'CLIP-KIT', name: 'Trim Clip Kit', category: 'Hardware', minStock: 10, currentStock: 5 },
];

interface SupplierPartRow {
  supplierId: string;
  partId: string;
  supplierSku?: string;
  wholesalePrice: number;
  preferred: boolean;
}

const localSupplierParts: SupplierPartRow[] = [
  { supplierId: 'sup-ford', partId: 'cat-1', supplierSku: 'FL3Z-17D957-AAPTM', wholesalePrice: 612.4, preferred: false },
  { supplierId: 'sup-keystone', partId: 'cat-1', supplierSku: 'KS-BUMP-F150', wholesalePrice: 498.0, preferred: false },
  { supplierId: 'sup-lkq', partId: 'cat-1', supplierSku: 'LKQ-88213', wholesalePrice: 410.0, preferred: true },
  { supplierId: 'sup-ford', partId: 'cat-2', supplierSku: 'JL34-13008-AH', wholesalePrice: 340.0, preferred: false },
  { supplierId: 'sup-lkq', partId: 'cat-2', supplierSku: 'LKQ-55190', wholesalePrice: 285.0, preferred: true },
  { supplierId: 'sup-keystone', partId: 'cat-3', supplierSku: 'KS-GRILLE-F150', wholesalePrice: 174.99, preferred: true },
  { supplierId: 'sup-ford', partId: 'cat-3', supplierSku: 'FL3Z-8200-BA', wholesalePrice: 402.0, preferred: false },
  { supplierId: 'sup-ford', partId: 'cat-4', supplierSku: 'FL3Z-16612-A', wholesalePrice: 848.75, preferred: true },
  { supplierId: 'sup-keystone', partId: 'cat-4', supplierSku: 'KS-HOOD-F150', wholesalePrice: 690.0, preferred: false },
  { supplierId: 'sup-keystone', partId: 'cat-5', supplierSku: 'KS-CLIP-KIT', wholesalePrice: 22.5, preferred: true },
  { supplierId: 'sup-lkq', partId: 'cat-5', supplierSku: 'LKQ-CLIP', wholesalePrice: 19.99, preferred: false },
];

const localPOs: PurchaseOrder[] = [
  {
    id: 'po-1001',
    supplierId: 'sup-lkq',
    status: 'SENT',
    createdAt: '2026-07-27T18:00:00.000Z',
    items: [{ id: 'poi-1', poId: 'po-1001', partId: 'cat-1', quantity: 1, unitPrice: 410.0 }],
  },
];

// --- reads ------------------------------------------------------------------
interface CatalogRow {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  min_stock: number | null;
  current_stock: number | null;
}

/** Loads the shop parts catalog (DB when available, else local). */
export async function getCatalogItems(): Promise<CatalogItem[]> {
  const supabase = getSupabaseBrowserClient();
  const result = await executeDBOperation<CatalogRow[]>(
    'getCatalogItems',
    async () => {
      const res = await supabase.from('parts_catalog').select('*').order('name', { ascending: true });
      return { data: res.data as unknown as CatalogRow[] | null, error: res.error };
    },
    [],
  );
  if (result.data && result.data.length > 0) {
    return result.data.map((r) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      category: r.category ?? undefined,
      minStock: r.min_stock ?? 0,
      currentStock: r.current_stock ?? 0,
    }));
  }
  return localCatalog.map((c) => ({ ...c }));
}

interface SupplierPartJoinRow {
  supplier_id: string;
  part_id: string;
  supplier_sku: string | null;
  wholesale_price: number | null;
  preferred: boolean | null;
  suppliers: { name: string | null; lead_time_days: number | null } | null;
}

/** Vendor price matrix for one catalog part, sorted cheapest-first. */
export async function getSupplierPriceMatrix(partId: string): Promise<SupplierPartMatrix[]> {
  const supabase = getSupabaseBrowserClient();
  const result = await executeDBOperation<SupplierPartJoinRow[]>(
    'getSupplierPriceMatrix',
    async () => {
      const res = await supabase
        .from('supplier_parts')
        .select('supplier_id, part_id, supplier_sku, wholesale_price, preferred, suppliers ( name, lead_time_days )')
        .eq('part_id', partId);
      return { data: res.data as unknown as SupplierPartJoinRow[] | null, error: res.error };
    },
    [],
  );

  let rows: SupplierPartMatrix[];
  if (result.data && result.data.length > 0) {
    rows = result.data.map((r) => ({
      supplierId: r.supplier_id,
      supplierName: r.suppliers?.name ?? 'Unknown supplier',
      partId: r.part_id,
      supplierSku: r.supplier_sku ?? undefined,
      wholesalePrice: r.wholesale_price ?? 0,
      preferred: r.preferred ?? false,
      leadTimeDays: r.suppliers?.lead_time_days ?? 0,
    }));
  } else {
    rows = localSupplierParts
      .filter((sp) => sp.partId === partId)
      .map((sp) => {
        const supplier = localSuppliers.find((s) => s.id === sp.supplierId);
        return {
          supplierId: sp.supplierId,
          supplierName: supplier?.name ?? 'Unknown supplier',
          partId: sp.partId,
          supplierSku: sp.supplierSku,
          wholesalePrice: sp.wholesalePrice,
          preferred: sp.preferred,
          leadTimeDays: supplier?.leadTimeDays ?? 0,
        };
      });
  }
  return rows.sort((a, b) => a.wholesalePrice - b.wholesalePrice);
}

// --- writes -----------------------------------------------------------------
export interface CreatePOItemInput {
  partId: string;
  quantity: number;
  unitPrice: number;
}

/** Creates a purchase order with line items (DB when available, else local). */
export async function createPurchaseOrder(
  supplierId: string,
  items: CreatePOItemInput[],
): Promise<PurchaseOrder> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data: po, error: poErr } = await supabase
      .from('purchase_orders')
      .insert({ supplier_id: supplierId, status: 'DRAFT' })
      .select('id, supplier_id, status, created_at')
      .single();
    if (!poErr && po) {
      const poRow = po as { id: string; supplier_id: string; status: string; created_at: string };
      const itemRows = items.map((it) => ({
        po_id: poRow.id,
        part_id: it.partId,
        quantity: it.quantity,
        unit_price: it.unitPrice,
      }));
      const { data: inserted } = await supabase
        .from('purchase_order_items')
        .insert(itemRows)
        .select('id, po_id, part_id, quantity, unit_price');
      const rows = (inserted as
        | { id: string; po_id: string; part_id: string; quantity: number; unit_price: number }[]
        | null) ?? [];
      return {
        id: poRow.id,
        supplierId: poRow.supplier_id,
        status: 'DRAFT',
        createdAt: poRow.created_at,
        items: rows.map((r) => ({
          id: r.id,
          poId: r.po_id,
          partId: r.part_id,
          quantity: r.quantity,
          unitPrice: r.unit_price,
        })),
      };
    }
  } catch {
    /* fall through to local store */
  }

  const poId = genId('po');
  const po: PurchaseOrder = {
    id: poId,
    supplierId,
    status: 'DRAFT',
    createdAt: new Date().toISOString(),
    items: items.map<POItem>((it) => ({
      id: genId('poi'),
      poId,
      partId: it.partId,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
    })),
  };
  localPOs.push(po);
  return po;
}

/** Adjusts a catalog part's stock by `delta` (DB when available, else local). */
export async function updateStockLevel(partId: string, delta: number): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase
      .from('parts_catalog')
      .select('current_stock')
      .eq('id', partId)
      .maybeSingle();
    const current = (data as { current_stock: number | null } | null)?.current_stock;
    if (current != null) {
      const { error } = await supabase
        .from('parts_catalog')
        .update({ current_stock: current + delta })
        .eq('id', partId);
      if (!error) return;
    }
  } catch {
    /* fall through to local */
  }
  const item = localCatalog.find((c) => c.id === partId);
  if (item) item.currentStock = Math.max(0, item.currentStock + delta);
}
