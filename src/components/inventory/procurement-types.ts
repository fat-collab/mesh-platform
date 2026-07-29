/**
 * MESH Procurement — types bridging RO parts (parts_line_items) to purchase
 * orders. Powers the Parts Request Queue and Active Purchase Orders tabs.
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
  claimNumber: string;
  customerName: string | null;
  vehicle: string;
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

/** A purchase order tied back to the repair order (claim) it serves. */
export interface ProcurementPO {
  id: string;
  claimNumber: string;
  supplierId: string | null;
  status: ProcurementPOStatus;
  createdAt: string;
  items: ProcurementPOItem[];
}
