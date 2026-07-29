/**
 * MESH — central type barrel.
 *
 * A single import surface that re-exports the per-feature type declarations.
 * Types only (erased at compile) — safe to import from client or server; it
 * pulls in no runtime code. See docs/SCHEMA_OVERVIEW.md for the full map.
 *
 * NOTE: two distinct audit types exist. The comms/activity ledger entry is
 * re-exported here as `AuditLogEntry`; the hold-gate activity-stream entry is
 * aliased to `HoldGateActivityEntry` to avoid a name clash.
 */

// --- Database rows / enums (Supabase) ---------------------------------------
export type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
  Organization,
  Location,
  User,
  Vehicle,
  RepairOrder,
  TotalLossAudit,
  HoldGateLog,
  ProofOfPayment,
  PayoutSplit,
  RoStage,
  HoldGateType,
  UserRole,
  PayoutStatus,
  PayoutSplitRole,
} from '@/lib/database.types';

// --- Ops (board, parts, OEM, RO-scoping) ------------------------------------
export type {
  PartStatus,
  PartSourcingTier,
  DiscrepancyReason,
  PartsLineItem,
  HoldCategory,
  HoldAction,
  ScopeCategory,
  ScopeLineItem,
  SupplementPackage,
  StructuralMaterial,
  OEMSpecData,
  StaffRole,
  OrderAssignment,
  // Hold-gate activity-stream entry (aliased to avoid clashing with the
  // comms ledger AuditLogEntry below).
  AuditLogEntry as HoldGateActivityEntry,
} from '@/components/ops/types';

// --- Sales & intake (leads, mobile intake, rental fleet) --------------------
export type {
  LeadStatus,
  IntakeLead,
  RentalStatus,
  RentalVehicle,
  RentalAssignmentInfo,
  IntakeDocKind,
  IntakeDocumentRef,
  WalkaroundItem,
  HailSeverity,
  HailPanelAssessment,
  IntakeSubmission,
} from '@/components/sales/types';

// --- Supplements (carrier claims) -------------------------------------------
export type {
  SupplementItemCategory,
  SupplementItemStatus,
  SupplementItem,
  SupplementLifecycle,
  SupplementRecord,
} from '@/components/supplements/types';

// --- Onboarding (shop profile & SOP) ----------------------------------------
export type {
  StaffMember,
  PdrMatrixRow,
  OperatingHours,
  ShopConfig,
} from '@/components/onboarding/types';

// --- Audit / communication ledger -------------------------------------------
export type { AuditChannel, AuditDirection, AuditLogEntry } from '@/lib/audit/types';

// --- Carrier tiers & FNOL ----------------------------------------------------
export type { CarrierTier, CarrierTierInfo } from '@/lib/carrier-tiers';

// --- Vision / OCR ------------------------------------------------------------
export type { DocType, ExtractResult, VisionExtractor } from '@/lib/vision/client';

// --- Repair-order lifecycle status ------------------------------------------
// Post-production / financial lifecycle, distinct from the board's `ro_stage`
// (which drives the Ops Kanban + DB enum). New status layer — not yet wired to
// the DB or board.
export type RepairOrderStatus =
  | 'INTAKE'
  | 'TEARDOWN'
  | 'SUPPLEMENT'
  | 'REPAIR'
  | 'QC'
  | 'DELIVERED'
  | 'WARRANTY_HOLD' // 7-day post-delivery defect protection window
  | 'CLOSED_AUDITING' // Deductible collected & final carrier check cleared
  | 'PAYROLL_READY'; // Locked and cleared for technician matrix commission payout
