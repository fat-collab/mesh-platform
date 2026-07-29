/**
 * MESH Inventory — vendor & parts inventory types.
 *
 * Shop-level inventory (catalog + suppliers + purchase orders), distinct from
 * the RO-scoped repair_order_parts procurement model.
 */

export type PurchaseOrderStatus = 'DRAFT' | 'SENT' | 'RECEIVED';

export interface Supplier {
  id: string;
  name: string;
  contact?: string;
  leadTimeDays: number;
}

export interface CatalogItem {
  id: string;
  sku: string;
  name: string;
  category?: string;
  minStock: number;
  currentStock: number;
}

/** A supplier's offer for a given catalog part (row of the price matrix). */
export interface SupplierPartMatrix {
  supplierId: string;
  supplierName: string;
  partId: string;
  supplierSku?: string;
  wholesalePrice: number;
  preferred: boolean;
  leadTimeDays: number;
}

export interface POItem {
  id: string;
  poId: string;
  partId: string;
  quantity: number;
  unitPrice: number;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  status: PurchaseOrderStatus;
  createdAt: string;
  items: POItem[];
}
