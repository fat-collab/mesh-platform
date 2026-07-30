/**
 * MESH Procurement — types bridging RO parts (parts_line_items) to purchase
 * orders. Powers the Parts Request Queue and Active Purchase Orders tabs.
 *
 * Pure job-costing model: every purchase order is strictly coupled to a
 * repair order (repairOrderId) and a VIN snapshot — no generalized warehouse
 * SKU/stock catalog exists in this app.
 */
import type { PartsLineItem } from '@/components/ops/types';

export type ProcurementPOStatus = 'DRAFT' | 'SENT' | 'RECEIVED';

export const PO_STATUS_LABEL: Record<ProcurementPOStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  RECEIVED: 'Received',
};

export const PO_STATUS_ORDER: ProcurementPOStatus[] = ['DRAFT', 'SENT', 'RECEIVED'];

/** Un-ordered parts for one active repair order, awaiting a PO. */
export interface PartsRequestGroup {
  repairOrderId: string;
  claimNumber: string;
  customerName: string | null;
  vehicle: string;
  /** Required to raise a PO — null blocks "Generate PO" (job-costing gate). */
  vin: string | null;
  /** parts_line_items with status NEEDED (each carries an id). */
  parts: PartsLineItem[];
}

export interface ProcurementPOItem {
  id: string;
  /** The parts_line_items row this line fulfills, when known. */
  partLineId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
}

/** A purchase order strictly coupled to the repair order + VIN it serves. */
export interface ProcurementPO {
  id: string;
  repairOrderId: string;
  vin: string;
  /** Display-only, joined from the RO — not a linking key. */
  claimNumber: string | null;
  customerName: string | null;
  status: ProcurementPOStatus;
  createdAt: string;
  items: ProcurementPOItem[];
}
