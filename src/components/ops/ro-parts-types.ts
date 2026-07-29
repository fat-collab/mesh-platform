/**
 * MESH Ops — repair-order parts model (RO-scoped).
 *
 * A simple parts list keyed by repair order id (order → many parts), with a
 * lifecycle status and OEM/aftermarket/salvage/used sourcing. Intentionally
 * SEPARATE from the claim-scoped `PartsLineItem` in `./types` (which models the
 * estimate/invoice/discrepancy operations layer over `parts_line_items`): the
 * two use different status vocabularies and live side by side.
 */

/** Sourcing origin for an RO part. */
export type PartType = 'OEM' | 'AFTERMARKET' | 'SALVAGE' | 'USED';

/** Lifecycle of an RO part, order → received/returned. */
export type PartStatus = 'NEEDED' | 'ORDERED' | 'SHIPPED' | 'RECEIVED' | 'RETURNED';

export const PART_TYPE_LABEL: Record<PartType, string> = {
  OEM: 'OEM',
  AFTERMARKET: 'Aftermarket',
  SALVAGE: 'Salvage',
  USED: 'Used',
};

export const PART_STATUS_LABEL: Record<PartStatus, string> = {
  NEEDED: 'Needed',
  ORDERED: 'Ordered',
  SHIPPED: 'Shipped',
  RECEIVED: 'Received',
  RETURNED: 'Returned',
};

export const PART_STATUS_ORDER: PartStatus[] = [
  'NEEDED',
  'ORDERED',
  'SHIPPED',
  'RECEIVED',
  'RETURNED',
];

export interface RepairOrderPart {
  id: string;
  repairOrderId: string;
  partName: string;
  partNumber?: string;
  vendor?: string;
  partType: PartType;
  status: PartStatus;
  cost: number;
  eta?: string;
  createdAt: string;
}
