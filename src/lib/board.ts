/**
 * MESH Platform — Repair board (drag board) configuration.
 *
 * The 8 stages and which of them are Hold Gates (business rule C). A card in a
 * hold stage with `hold_gate_active` renders a lock badge and cannot be dragged
 * out until the gate is unlocked.
 */
import type { HoldGateType, RoStage } from './database.types';

/** Column order, left → right, matching the ro_stage enum. */
export const STAGE_ORDER: readonly RoStage[] = [
  'INTAKE',
  'TEARDOWN',
  'HOLD_CARRIER',
  'PDR_REPAIR',
  'HOLD_PARTS',
  'ADAS_SUBLET',
  'HOLD_TOTAL_LOSS',
  'QC_DELIVERY',
];

export type StageTone = 'neutral' | 'amber' | 'red';

export interface StageMeta {
  label: string;
  /** True for the three Hold Gate stages. */
  hold: boolean;
  /** The gate type a card entering this stage locks under. */
  gateType: HoldGateType | null;
  tone: StageTone;
}

export const STAGE_META: Record<RoStage, StageMeta> = {
  INTAKE: { label: 'Intake', hold: false, gateType: null, tone: 'neutral' },
  TEARDOWN: { label: 'Teardown', hold: false, gateType: null, tone: 'neutral' },
  HOLD_CARRIER: {
    label: 'Hold · Carrier',
    hold: true,
    gateType: 'CARRIER_SUPPLEMENT',
    tone: 'amber',
  },
  PDR_REPAIR: { label: 'PDR Repair', hold: false, gateType: null, tone: 'neutral' },
  HOLD_PARTS: {
    label: 'Hold · Parts',
    hold: true,
    gateType: 'PARTS_BACKORDER',
    tone: 'amber',
  },
  ADAS_SUBLET: { label: 'ADAS Sublet', hold: false, gateType: null, tone: 'neutral' },
  HOLD_TOTAL_LOSS: {
    label: 'Hold · Total Loss',
    hold: true,
    gateType: 'TOTAL_LOSS_REBUTTAL',
    tone: 'red',
  },
  QC_DELIVERY: { label: 'QC & Delivery', hold: false, gateType: null, tone: 'neutral' },
};

export const GATE_TYPE_LABEL: Record<HoldGateType, string> = {
  CARRIER_SUPPLEMENT: 'Carrier Supplement',
  PARTS_BACKORDER: 'Parts Backorder',
  TOTAL_LOSS_REBUTTAL: 'Total Loss Rebuttal',
};

export function isHoldStage(stage: RoStage): boolean {
  return STAGE_META[stage].hold;
}

export function gateTypeForStage(stage: RoStage): HoldGateType | null {
  return STAGE_META[stage].gateType;
}

/** A repair order as rendered on the board. */
export interface BoardOrder {
  created_at?: string;
  updated_at?: string;
  id: string;
  claim_number: string | null;
  customer_name: string | null;
  /** e.g. "2021 Ford F-150". */
  vehicle: string;
  /** Full 17-char VIN, when known — searchable (incl. by last 8 digits). */
  vin?: string | null;
  location: string;
  stage: RoStage;
  hold_gate_active: boolean;
  /** Latest total-loss risk score, if an audit exists. */
  risk_score: number | null;
  /** Repair completion ETA (ISO), for rental policy-expiry countdowns. */
  targetDeliveryDate?: string | null;
  /** Optional flags surfaced on the card. */
  aluminum?: boolean;
  /** Insurance carrier, when the RO originated from field intake. */
  insuranceCarrier?: string | null;
  /** Sales rep accountable for the lead, carried onto the floor on conversion. */
  assignedStaffName?: string | null;
  /** Field-intake context carried over on conversion (visible to managers). */
  intakeNotes?: string | null;
  intakeHail?: { panel: string; severity: string }[];
  intakeDocuments?: { kind: string; fileName: string; storagePath?: string | null }[];
}

export type RiskTone = 'low' | 'medium' | 'high';

/** Classifies a total-loss risk score for badge coloring. */
export function riskTone(score: number): RiskTone {
  if (score >= 1) return 'high';
  if (score >= 0.85) return 'medium';
  return 'low';
}
