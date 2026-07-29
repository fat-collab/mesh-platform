/**
 * MESH — carrier tier classification & FNOL handling protocols.
 *
 * Lean, static reference mapping an insurance carrier name to its automation
 * tier, primary friction point, and the field FNOL strategy for capturing a
 * valid claim number on the driveway. Framework-agnostic (safe anywhere).
 */

export type CarrierTier = 1 | 2 | 3;

export interface CarrierTierInfo {
  tier: CarrierTier;
  label: string;
  friction: string;
  fnolStrategy: string;
  /** The keyword that matched, or undefined when defaulted (unrecognized). */
  matchedCarrier?: string;
}

export const CARRIER_TIER_META: Record<
  CarrierTier,
  { label: string; friction: string; fnolStrategy: string }
> = {
  1: {
    label: 'National Giant',
    friction: 'App password fatigue & MFA delays.',
    fnolStrategy:
      'Deep-link to the carrier’s express FNOL web portal, or trigger a one-touch pre-authenticated dialer to bypass the general customer-service queue.',
  },
  2: {
    label: 'Regional / Mutual',
    friction: 'Local agents steering to preferred DRP networks.',
    fnolStrategy:
      'Surface statutory steering-defense prompts — reinforce the policyholder’s legal right to choose an independent repair facility.',
  },
  3: {
    label: 'Non-Standard / Budget',
    friction: 'After-hours submission errors; restricted call-center hours.',
    fnolStrategy:
      'Async queue capture: log preliminary photo evidence now and queue an automated morning follow-up for office admin.',
  },
};

export const CARRIER_TIER_TONE: Record<CarrierTier, string> = {
  1: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  2: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  3: 'border-red-500/40 bg-red-500/15 text-red-200',
};

// National giants (incl. large nationals with strong digital FNOL). Checked
// before the Tier-2 'mutual' keyword so e.g. "Liberty Mutual" resolves to T1.
const TIER1_KEYWORDS = [
  'state farm',
  'progressive',
  'allstate',
  'geico',
  'usaa',
  'farmers',
  'nationwide',
  'liberty mutual',
  'travelers',
  'american family',
];

// Regional & mutual carriers (agent-dependent / DRP-steering risk).
const TIER2_KEYWORDS = ['farm bureau', 'auto-owners', 'auto owners', 'grange', 'mutual'];

/**
 * Classifies a carrier by name into its tier + FNOL handling protocol.
 * Unrecognized carriers default to Tier 3 (treat as low-automation).
 */
export function classifyCarrier(carrier: string): CarrierTierInfo {
  const n = carrier.trim().toLowerCase();
  const find = (kws: string[]) => kws.find((k) => n.includes(k));

  let tier: CarrierTier = 3;
  let matched: string | undefined;

  const t1 = find(TIER1_KEYWORDS);
  if (t1) {
    tier = 1;
    matched = t1;
  } else {
    const t2 = find(TIER2_KEYWORDS);
    if (t2) {
      tier = 2;
      matched = t2;
    }
  }

  return { tier, ...CARRIER_TIER_META[tier], matchedCarrier: matched };
}
