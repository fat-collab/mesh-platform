/**
 * MESH Sales & Intake — lead pipeline types.
 *
 * Self-contained within the sales feature. Models the pre-production intake
 * funnel (lead → estimate → approval) before a lead converts into an Ops RO.
 */

export type LeadStatus =
  | 'NEW'
  | 'CONTACTED'
  | 'ESTIMATE_SENT'
  | 'AOB_SIGNED'
  | 'APPROVED'
  | 'CONVERTED'
  | 'LOST'
  | 'LOST_TO_COMPETITOR'
  | 'CANCELLED';

export interface IntakeLead {
  id: string;
  customerName: string;
  phone: string;
  email: string;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  vinLast8: string;
  insuranceCarrier: string;
  claimNumber: string;
  status: LeadStatus;
  /** ISO timestamp the lead was taken in. */
  intakeDate: string;
  estimatedAmount: number;
  /** AOB / engagement agreement signed at intake (gates RO conversion). */
  agreementAccepted?: boolean;
  /** Sales rep / intake owner accountable for the lead (users.id). */
  assignedStaffId?: string;
  /** Display name of the accountable rep, denormalized for board rendering. */
  assignedStaffName?: string;
}

/** Pipeline column order, left → right. */
export const LEAD_STATUS_ORDER: readonly LeadStatus[] = [
  'NEW',
  'CONTACTED',
  'ESTIMATE_SENT',
  'AOB_SIGNED',
  'APPROVED',
  'CONVERTED',
  'LOST',
  'LOST_TO_COMPETITOR',
  'CANCELLED',
];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  ESTIMATE_SENT: 'Estimate Sent',
  AOB_SIGNED: 'AOB Signed',
  APPROVED: 'Approved',
  CONVERTED: 'Converted',
  LOST: 'Lost',
  LOST_TO_COMPETITOR: 'Lost — Competitor',
  CANCELLED: 'Cancelled',
};

// ---------------------------------------------------------------------------
// Rental / loaner fleet
// ---------------------------------------------------------------------------

export type RentalStatus = 'AVAILABLE' | 'RENTED' | 'MAINTENANCE';

export interface RentalVehicle {
  id: string;
  makeModel: string;
  licensePlate: string;
  currentStatus: RentalStatus;
  startingMileage?: number | null;
  currentMileage: number;
  /** Fuel level as a percentage (0–100). */
  fuelLevel: number;
  assignedCustomer?: string | null;
  /** The lead / RO id the loaner is assigned against. */
  assignedLeadId?: string | null;
  /** Field sales rep who checked the vehicle out. */
  assignedAgent?: string | null;
  expectedReturnDate?: string | null;
}

/** Rental assignment captured during mobile intake (dual-agreement package). */
export interface RentalAssignmentInfo {
  vehicleId: string;
  makeModel: string;
  licensePlate: string;
  startingMileage: number;
  fuelLevel: number;
  preDamageNotes: string;
  expectedReturnDate: string;
}

// ---------------------------------------------------------------------------
// Mobile field intake — document capture, walkaround & e-signature
// ---------------------------------------------------------------------------

export type IntakeDocKind =
  | 'DL_FRONT'
  | 'DL_BACK'
  | 'INSURANCE_CARD'
  | 'PRIOR_ESTIMATE'
  | 'WALKAROUND';

/** A captured/uploaded document reference (filename + local object URL). */
export interface IntakeDocumentRef {
  kind: IntakeDocKind;
  fileName: string;
  url?: string | null;
}

/** One pre-damage walkaround checklist item. */
export interface WalkaroundItem {
  id: string;
  label: string;
  flagged: boolean;
}

export type HailSeverity = 'NONE' | 'LIGHT' | 'MODERATE' | 'SEVERE';

/** Panel-by-panel hail severity assessment. */
export interface HailPanelAssessment {
  panel: string;
  severity: HailSeverity;
}

/** Full mobile-intake package captured at the vehicle. */
export interface IntakeSubmission {
  customerName: string;
  phone: string;
  email: string;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  vinLast8: string;
  insuranceCarrier: string;
  policyNumber: string;
  claimNumber: string;
  estimatedAmount: number;
  documents: IntakeDocumentRef[];
  walkaround: WalkaroundItem[];
  hailMatrix: HailPanelAssessment[];
  conditionNotes: string;
  /** Rep who took the intake — owns the lead from the moment it hits the board. */
  assignedStaffId?: string;
  assignedStaffName?: string;
  /** Rental/loaner assignment, when a loaner was provided (dual agreement). */
  rental?: RentalAssignmentInfo | null;
  /** PNG data URL of the customer's e-signature. */
  signatureDataUrl: string;
  /** ISO timestamp the service agreement was accepted. */
  agreementAcceptedAt: string;
}
