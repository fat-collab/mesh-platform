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
  /** Which Catastrophe Hub tab this lead is worked from. Defaults to
   *  DIGITAL_INBOUND when absent (pre-existing leads, web/social source). */
  channel?: LeadChannel;
  /** Storm/catastrophe campaign tag for lead-source ROI attribution. */
  stormTag?: string;
  /** Storm zip-code attribution. */
  zipCode?: string;
  /** Instant intake severity rating (Digital Inbound triage). */
  severity?: StormSeverity;
  /** Damage photos captured at digital intake. */
  damagePhotos?: IntakeDocumentRef[];
  /** Post-contact dual-path routing decision. */
  routingPath?: RoutingPath;
  /** Field agent assigned when routingPath is MOBILE_HOUSE_CALL. */
  dispatchStaffName?: string;
  dispatchStatus?: DispatchStatus;
  /** Named Insured / Policyholder Match — false when the person at intake
   *  isn't the policyholder on file (defaults true). */
  policyholderMatch?: boolean;
  /** Proxy policyholder details, captured when policyholderMatch is false. */
  proxyPolicyholder?: ProxyPolicyholder | null;
  /** Remote AOB secure-signing-link lifecycle, when dispatched to a proxy. */
  remoteAobStatus?: RemoteAobStatus;
  /** Token of the active remote-aob-links record for this lead, if any. */
  remoteAobToken?: string;
  /** Street address / property pin — captured at Quick Porch Capture or the
   *  full intake; optional either way. */
  address?: string;
  /** Initial damage triage from Quick Porch Capture, refined later. */
  damageType?: DamageType;
}

// ---------------------------------------------------------------------------
// Quick Porch Capture
// ---------------------------------------------------------------------------

/** Initial damage triage — a rough bucket, not the final estimate scope. */
export type DamageType = 'Collision' | 'Hail' | 'Dent' | 'Glass';

export const DAMAGE_TYPE_LABEL: Record<DamageType, string> = {
  Collision: 'Collision',
  Hail: 'Hail / Storm',
  Dent: 'Minor Dent / Scratch',
  Glass: 'Windshield / Glass',
};

// ---------------------------------------------------------------------------
// Catastrophe Legal & Carrier Intelligence Shield
// ---------------------------------------------------------------------------

/** Off-site policyholder details, captured when the person at intake isn't
 *  the Named Insured — used to dispatch a Remote AOB Secure Signing Link. */
export interface ProxyPolicyholder {
  fullName: string;
  relationship: string;
  phone: string;
  email: string;
}

/** Lifecycle of a dispatched Remote AOB Secure Signing Link. */
export type RemoteAobStatus = 'NOT_SENT' | 'SENT' | 'SIGNED';

// ---------------------------------------------------------------------------
// Catastrophe Lead Aggregator & Dispatch Hub
// ---------------------------------------------------------------------------

/** Which Sales & Intake hub tab a lead belongs to. */
export type LeadChannel = 'DIGITAL_INBOUND' | 'FIELD_DISPATCH';

export const LEAD_CHANNEL_LABEL: Record<LeadChannel, string> = {
  DIGITAL_INBOUND: 'Digital Inbound & Storm Triage',
  FIELD_DISPATCH: 'Field Agent Dispatch',
};

/** Instant severity rating assigned at digital intake triage. */
export type StormSeverity = 'MINOR' | 'MODERATE' | 'SEVERE' | 'CATASTROPHIC';

export const STORM_SEVERITY_ORDER: readonly StormSeverity[] = [
  'MINOR',
  'MODERATE',
  'SEVERE',
  'CATASTROPHIC',
];

export const STORM_SEVERITY_LABEL: Record<StormSeverity, string> = {
  MINOR: 'Minor',
  MODERATE: 'Moderate',
  SEVERE: 'Severe',
  CATASTROPHIC: 'Catastrophic',
};

/** Post-contact dual-path routing decision on a lead card. */
export type RoutingPath = 'SHOP_DROPOFF' | 'MOBILE_HOUSE_CALL';

export const ROUTING_PATH_LABEL: Record<RoutingPath, string> = {
  SHOP_DROPOFF: 'Shop Drop-off + Fleet Reservation',
  MOBILE_HOUSE_CALL: 'Mobile House Call',
};

/** Field dispatch lifecycle, once a lead is routed to a mobile house call. */
export type DispatchStatus = 'DISPATCHED' | 'EN_ROUTE' | 'ON_SITE' | 'COMPLETED';

export const DISPATCH_STATUS_ORDER: readonly DispatchStatus[] = [
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SITE',
  'COMPLETED',
];

export const DISPATCH_STATUS_LABEL: Record<DispatchStatus, string> = {
  DISPATCHED: 'Dispatched',
  EN_ROUTE: 'En Route',
  ON_SITE: 'On Site',
  COMPLETED: 'Completed',
};

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

export type RentalStatus = 'AVAILABLE' | 'RESERVED' | 'RENTED' | 'MAINTENANCE';

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
  | 'WALKAROUND'
  | 'DAMAGE_PHOTO'
  | 'VIN_TO_DAMAGE_ALIGNMENT'
  | 'LINE_BOARD_SWEEP'
  | 'FOUR_CORNER_PHOTOS'
  | 'UNDERSIDE_BRACING_SHOTS';

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
  /** PNG data URL of the customer's e-signature. Empty when the AOB is being
   *  routed to a remote proxy policyholder instead of signed on-site. */
  signatureDataUrl: string;
  /** ISO timestamp the service agreement was accepted. */
  agreementAcceptedAt: string;
  /** Named Insured / Policyholder Match (defaults true). */
  policyholderMatch?: boolean;
  /** Proxy policyholder details, required when policyholderMatch is false. */
  proxyPolicyholder?: ProxyPolicyholder | null;
}
