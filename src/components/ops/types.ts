/**
 * MESH Ops — parts & line-item types for the RO Detail drawer, plus the audit
 * history / hold-activity model.
 *
 * Self-contained within the ops feature. There is no parts table in the
 * database schema yet, so these model the client-side parts operations layer
 * (invoice capture + discrepancy handling); edits live in component state.
 */
import type { HoldGateType } from '@/lib/database.types';

/** Lifecycle of a single parts line item. */
export type PartStatus =
  | 'NEEDED'
  | 'ORDERED'
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'DISCREPANCY';

/** Where a part is sourced from — OEM vs recycled (LKQ) vs aftermarket. */
export type PartSourcingTier = 'OEM' | 'LKQ' | 'AFTERMARKET' | 'RECONDITIONED';

export const PART_SOURCING_LABEL: Record<PartSourcingTier, string> = {
  OEM: 'OEM',
  LKQ: 'LKQ',
  AFTERMARKET: 'Aftermarket',
  RECONDITIONED: 'Reconditioned',
};

/** Why a received part was rejected / flagged as an exception. */
export type DiscrepancyReason =
  | 'DAMAGED_IN_TRANSIT'
  | 'WRONG_PART_NUMBER'
  | 'INCORRECT_FITMENT'
  | 'DEFECTIVE'
  | 'MISSING_HARDWARE';

export interface PartsLineItem {
  /** DB primary key when persisted; absent for local/mock items. */
  id?: string | null;
  name: string;
  status: PartStatus;
  /** OEM vs LKQ vs aftermarket sourcing. */
  sourcingTier: PartSourcingTier;
  /** CAPA-certified (relevant for aftermarket structural/crash parts). */
  capaCertified?: boolean;
  /** Estimate line-item detail (from EMS/BMS import). */
  partNumber?: string | null;
  vendorName?: string | null;
  quantity?: number | null;
  unitCost?: number | null;
  /** Supplier lead-time estimate, in days. */
  leadTimeDays?: number | null;
  /** Invoice capture (set on Mark Received). */
  invoiceNumber?: string | null;
  invoiceUrl?: string | null;
  /** Discrepancy / exception details (set on Report Broken/Wrong Part). */
  discrepancyReason?: DiscrepancyReason | null;
  discrepancyNotes?: string | null;
  returnRmaNumber?: string | null;
  /** ISO date (yyyy-mm-dd) the replacement is expected. */
  replacementExpectedDate?: string | null;
}

export const PART_STATUS_LABEL: Record<PartStatus, string> = {
  NEEDED: 'Needed',
  ORDERED: 'Ordered',
  IN_TRANSIT: 'In Transit',
  RECEIVED: 'Received',
  DISCREPANCY: 'Discrepancy',
};

export const DISCREPANCY_REASONS: readonly DiscrepancyReason[] = [
  'DAMAGED_IN_TRANSIT',
  'WRONG_PART_NUMBER',
  'INCORRECT_FITMENT',
  'DEFECTIVE',
  'MISSING_HARDWARE',
];

export const DISCREPANCY_REASON_LABEL: Record<DiscrepancyReason, string> = {
  DAMAGED_IN_TRANSIT: 'Damaged in transit',
  WRONG_PART_NUMBER: 'Wrong part number',
  INCORRECT_FITMENT: 'Incorrect fitment',
  DEFECTIVE: 'Defective',
  MISSING_HARDWARE: 'Missing hardware',
};

// ---------------------------------------------------------------------------
// Staff assignment — who owns / works a repair order (multi-role)
// ---------------------------------------------------------------------------

/** Role a staff member plays on a given repair order. */
export type StaffRole = 'SALES' | 'ESTIMATOR' | 'BODY_TECH' | 'PAINTER' | 'FOREMAN';

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  SALES: 'Sales',
  ESTIMATOR: 'Estimator',
  BODY_TECH: 'Body Tech',
  PAINTER: 'Painter',
  FOREMAN: 'Foreman',
};

/** Order of roles as they should appear in the RO staffing panel. */
export const STAFF_ROLE_ORDER: readonly StaffRole[] = [
  'SALES',
  'ESTIMATOR',
  'BODY_TECH',
  'PAINTER',
  'FOREMAN',
];

/**
 * A staff member assigned to a repair order in a specific role. Relational
 * (one RO → many assignments), unlike the single denormalized owner surfaced on
 * the board card.
 */
export interface OrderAssignment {
  id: string;
  repairOrderId: string;
  staffId: string;
  staffName: string;
  role: StaffRole;
  /** ISO timestamp the assignment was made. */
  assignedAt: string;
}

// ---------------------------------------------------------------------------
// Audit history / hold activity stream
// ---------------------------------------------------------------------------

/** Grouping of hold gates for the audit view (richer than the 3 DB enums). */
export type HoldCategory = 'Parts' | 'Insurance' | 'Tech' | 'Sublet' | 'Total Loss';

/** Lifecycle action recorded against a hold gate. */
export type HoldAction = 'PLACED_ON_HOLD' | 'RESOLVED' | 'OVERRIDDEN';

export const HOLD_CATEGORY_LABEL: Record<HoldCategory, string> = {
  Parts: 'Parts Discrepancy',
  Insurance: 'Insurance Auth',
  Tech: 'Tech Stalling',
  Sublet: 'Sublet',
  'Total Loss': 'Total Loss Rebuttal',
};

/** Quick-filter categories shown in the audit toolbar. */
export const AUDIT_FILTER_CATEGORIES: readonly HoldCategory[] = [
  'Parts',
  'Insurance',
  'Tech',
  'Sublet',
];

export const HOLD_ACTION_LABEL: Record<HoldAction, string> = {
  PLACED_ON_HOLD: 'Placed on hold',
  RESOLVED: 'Resolved',
  OVERRIDDEN: 'Overridden',
};

/** Maps a DB hold_gate_type to the audit view's category. */
export function categoryForGateType(gateType: HoldGateType | null): HoldCategory {
  switch (gateType) {
    case 'PARTS_BACKORDER':
      return 'Parts';
    case 'CARRIER_SUPPLEMENT':
      return 'Insurance';
    case 'TOTAL_LOSS_REBUTTAL':
      return 'Total Loss';
    default:
      return 'Parts';
  }
}

// ---------------------------------------------------------------------------
// Internal estimator scoping & supplements
// ---------------------------------------------------------------------------

export type ScopeCategory = 'BODY' | 'PAINT' | 'FRAME' | 'MECHANICAL' | 'ADAS';

/** A single scoped line item (labor/part/misc) on a supplement. */
export interface ScopeLineItem {
  id: string;
  claimNumber: string;
  category: ScopeCategory;
  description: string;
  itemType: 'LABOR' | 'PART' | 'MISC';
  hoursOrQuantity: number;
  unitRate: number;
  total: number;
  teardownDiscovered: boolean;
  justificationNotes: string;
}

/** A supplement request bundling scoped line items for adjuster review. */
export interface SupplementPackage {
  id: string;
  claimNumber: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'DENIED';
  items: ScopeLineItem[];
  totalDelta: number;
  adjusterNotes: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// OEM spec lookup & structural body rules
// ---------------------------------------------------------------------------

/** Structural body material classification for repair-rule gating. */
export type StructuralMaterial =
  | 'Aluminum'
  | 'Steel'
  | 'Mixed / UHSS'
  | 'Carbon Composite';

/** OEM specification + structural repair ruleset for a VIN. */
export interface OEMSpecData {
  vinLast8: string;
  trimPackage: string;
  paintCode: string;
  paintName: string;
  bodyType: string;
  /** OEM structural repair mandates/restrictions surfaced to the tech. */
  structuralRules: string[];
  oemScanRequired: boolean;
  structuralMaterial: StructuralMaterial;
}

/** One entry in the hold-activity feed (mapped from hold_gate_logs). */
export interface AuditLogEntry {
  id: string;
  claimNumber: string | null;
  vin?: string | null;
  category: HoldCategory;
  operator: string;
  action: HoldAction;
  reason?: string | null;
  /** ISO timestamp the hold was placed. */
  lockedAt: string;
  /** ISO timestamp the hold was resolved/overridden, if closed. */
  resolvedAt?: string | null;
}
