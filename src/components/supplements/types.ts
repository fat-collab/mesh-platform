/**
 * MESH — insurance supplement & photo audit types.
 *
 * Distinct from the RO-drawer internal scoping (SupplementPackage/ScopeLineItem
 * in components/ops/types.ts): this models carrier-facing supplement claims with
 * a payment lifecycle, per-line audit status, and photo evidence.
 */

export type SupplementItemCategory =
  | 'PDR_LABOR'
  | 'R_I_LABOR'
  | 'PARTS'
  | 'CLIP_FASTENER'
  | 'MATERIALS';

export type SupplementItemStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'REVISED';

export interface SupplementItem {
  id: string;
  description: string;
  category: SupplementItemCategory;
  originalCost: number;
  requestedCost: number;
  status: SupplementItemStatus;
  /** Photo evidence reference (URL or object URL). */
  photoUrl?: string | null;
}

export type SupplementLifecycle =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED_PENDING_PAYMENT'
  | 'PAID';

export interface SupplementRecord {
  id: string;
  roId: string;
  customerName: string;
  vehicleInfo: string;
  insuranceCarrier: string;
  claimNumber: string;
  lifecycleStatus: SupplementLifecycle;
  items: SupplementItem[];
  totalDeltaAmount: number;
  carrierNotes: string;
  /** Assigned adjuster contact (for AI call dispatch / follow-up). */
  adjusterName?: string;
  adjusterPhone?: string;
  createdAt: string;
}

export const SUPPLEMENT_CATEGORIES: readonly SupplementItemCategory[] = [
  'PDR_LABOR',
  'R_I_LABOR',
  'PARTS',
  'CLIP_FASTENER',
  'MATERIALS',
];

export const SUPPLEMENT_CATEGORY_LABEL: Record<SupplementItemCategory, string> = {
  PDR_LABOR: 'PDR Labor',
  R_I_LABOR: 'R&I Labor',
  PARTS: 'Parts',
  CLIP_FASTENER: 'Clips & Fasteners',
  MATERIALS: 'Materials',
};

export const SUPPLEMENT_ITEM_STATUSES: readonly SupplementItemStatus[] = [
  'PENDING',
  'APPROVED',
  'DENIED',
  'REVISED',
];

export const LIFECYCLE_ORDER: readonly SupplementLifecycle[] = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED_PENDING_PAYMENT',
  'PAID',
];

export const LIFECYCLE_LABEL: Record<SupplementLifecycle, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED_PENDING_PAYMENT: 'Approved · Pending Payment',
  PAID: 'Paid',
};

/** Lifecycle states whose dollars are "in limbo" (submitted but unpaid). */
export const UNPAID_LIFECYCLE: readonly SupplementLifecycle[] = [
  'SUBMITTED',
  'APPROVED_PENDING_PAYMENT',
];
