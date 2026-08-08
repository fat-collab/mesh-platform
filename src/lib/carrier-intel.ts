/**
 * MESH — carrier lowball/supplement risk intelligence & dynamic checklists.
 *
 * Distinct from carrier-tiers.ts (FNOL automation/friction handling): this is
 * the claim-integrity layer — how aggressively a carrier's initial estimate
 * tends to lowball damage, whether supplements should be expected, and which
 * additional photo/documentation evidence the field intake should capture
 * up front so a later supplement fight isn't starved of proof. Lean, static
 * reference data — no external dependency.
 */
import type { IntakeDocKind } from '@/components/sales/types';

export type LowballRisk = 'LOW' | 'MODERATE' | 'HIGH';

/** The carrier-checklist-eligible subset of IntakeDocKind. */
export type ChecklistItemId = Extract<
  IntakeDocKind,
  'VIN_TO_DAMAGE_ALIGNMENT' | 'LINE_BOARD_SWEEP' | 'FOUR_CORNER_PHOTOS' | 'UNDERSIDE_BRACING_SHOTS'
>;

export const CHECKLIST_ITEM_LABEL: Record<ChecklistItemId, string> = {
  VIN_TO_DAMAGE_ALIGNMENT: 'VIN-to-Damage Alignment Shot',
  LINE_BOARD_SWEEP: 'Line-Board Sweep',
  FOUR_CORNER_PHOTOS: 'Four-Corner Photos',
  UNDERSIDE_BRACING_SHOTS: 'Underside Bracing Shots',
};

export interface CarrierIntel {
  riskProfile: LowballRisk;
  /** Known for aggressive drive-by / photo-only lowball estimates. */
  lowballFlag: boolean;
  /** A carrier supplement should be expected as a normal part of the claim. */
  supplementFlag: boolean;
  requiredChecklist: ChecklistItemId[];
}

const DEFAULT_INTEL: CarrierIntel = {
  riskProfile: 'MODERATE',
  lowballFlag: false,
  supplementFlag: true,
  requiredChecklist: ['FOUR_CORNER_PHOTOS'],
};

/**
 * Keyed by the same lowercase substring-match convention as carrier-tiers.ts,
 * so both modules classify a free-text carrier name consistently.
 */
const CARRIER_INTEL: Record<string, CarrierIntel> = {
  'state farm': {
    riskProfile: 'HIGH',
    lowballFlag: true,
    supplementFlag: true,
    requiredChecklist: ['VIN_TO_DAMAGE_ALIGNMENT', 'LINE_BOARD_SWEEP'],
  },
  progressive: {
    riskProfile: 'HIGH',
    lowballFlag: true,
    supplementFlag: true,
    requiredChecklist: ['VIN_TO_DAMAGE_ALIGNMENT', 'FOUR_CORNER_PHOTOS'],
  },
  allstate: {
    riskProfile: 'HIGH',
    lowballFlag: true,
    supplementFlag: true,
    requiredChecklist: ['LINE_BOARD_SWEEP', 'UNDERSIDE_BRACING_SHOTS'],
  },
  usaa: {
    riskProfile: 'MODERATE',
    lowballFlag: false,
    supplementFlag: true,
    requiredChecklist: ['LINE_BOARD_SWEEP'],
  },
  geico: {
    riskProfile: 'MODERATE',
    lowballFlag: false,
    supplementFlag: true,
    requiredChecklist: ['FOUR_CORNER_PHOTOS'],
  },
  farmers: {
    riskProfile: 'MODERATE',
    lowballFlag: false,
    supplementFlag: true,
    requiredChecklist: ['FOUR_CORNER_PHOTOS'],
  },
  nationwide: {
    riskProfile: 'MODERATE',
    lowballFlag: false,
    supplementFlag: true,
    requiredChecklist: ['FOUR_CORNER_PHOTOS'],
  },
  'liberty mutual': {
    riskProfile: 'MODERATE',
    lowballFlag: false,
    supplementFlag: true,
    requiredChecklist: ['FOUR_CORNER_PHOTOS'],
  },
};

/**
 * Classifies a carrier's lowball/supplement risk and required intake
 * checklist. Unrecognized carriers default to MODERATE risk with the
 * single universal Four-Corner Photos requirement.
 */
export function getCarrierIntel(carrier: string): CarrierIntel {
  const n = carrier.trim().toLowerCase();
  if (!n) return DEFAULT_INTEL;
  const key = Object.keys(CARRIER_INTEL).find((k) => n.includes(k));
  return key ? CARRIER_INTEL[key] : DEFAULT_INTEL;
}

/**
 * True when `carrier` doesn't resolve to a specific carrier's intel and
 * DEFAULT_INTEL is what getCarrierIntel actually returned — covers both an
 * empty/unselected carrier and free text (a typo, or a deliberate "Other")
 * that doesn't match anything in CARRIER_INTEL. Every carrier-checklist UI
 * should use this to say so plainly rather than presenting DEFAULT_INTEL's
 * generic checklist as if it were that carrier's real requirements.
 */
export function isDefaultCarrierIntel(carrier: string): boolean {
  return getCarrierIntel(carrier) === DEFAULT_INTEL;
}

/**
 * Canonical display names for every carrier CARRIER_INTEL knows about — the
 * single source for any carrier picker in the app. Each name lowercases to
 * exactly one CARRIER_INTEL key, so picking one here always resolves to that
 * carrier's real intel, never DEFAULT_INTEL.
 */
export const KNOWN_CARRIERS: readonly string[] = [
  'State Farm',
  'Progressive',
  'Allstate',
  'USAA',
  'GEICO',
  'Farmers',
  'Nationwide',
  'Liberty Mutual',
];
