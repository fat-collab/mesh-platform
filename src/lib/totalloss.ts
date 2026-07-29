/**
 * MESH Platform — Total Loss ACV rebuttal math.
 *
 * Business rule B (CLAUDE.md):
 *   Risk = Conventional Cost / (ACV * Threshold%)
 *
 * A risk score >= 1.0 means the conventional cut/replace estimate meets or
 * exceeds the state's total-loss threshold — i.e. the carrier is likely to
 * declare a total loss. The PDR rebuttal argues the vehicle can be repaired
 * (via paintless dent repair) well under that threshold.
 */

export class TotalLossInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TotalLossInputError';
  }
}

function assertFinitePositive(label: string, value: number, allowZero = false): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TotalLossInputError(`${label} must be a finite number.`);
  }
  if (allowZero ? value < 0 : value <= 0) {
    throw new TotalLossInputError(
      `${label} must be ${allowZero ? 'zero or greater' : 'greater than zero'}.`,
    );
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/**
 * Total-loss risk score: conventionalCost / (acv * thresholdPct/100).
 *
 * @param conventionalCost Conventional cut/replace estimate (dollars).
 * @param acv              Actual Cash Value of the vehicle (dollars, > 0).
 * @param thresholdPct     State total-loss threshold as a percentage (e.g. 75).
 * @returns Risk score rounded to 4 decimals. >= 1.0 => total-loss territory.
 * @throws {TotalLossInputError} on invalid inputs.
 */
export function calculateRiskScore(
  conventionalCost: number,
  acv: number,
  thresholdPct: number,
): number {
  assertFinitePositive('conventionalCost', conventionalCost, true);
  assertFinitePositive('acv', acv);
  assertFinitePositive('thresholdPct', thresholdPct);

  const thresholdAmount = acv * (thresholdPct / 100);
  if (thresholdAmount <= 0) {
    throw new TotalLossInputError('Computed threshold amount must be greater than zero.');
  }

  return round4(conventionalCost / thresholdAmount);
}

export type RebuttalRecommendation = 'PDR_REPAIR' | 'REVIEW' | 'LIKELY_TOTAL_LOSS';

export interface RebuttalLineItem {
  /** Estimate under evaluation (dollars). */
  estimate: number;
  /** estimate / acv, as a percentage of ACV. */
  pctOfAcv: number;
  /** estimate / thresholdAmount. >= 1.0 crosses the total-loss threshold. */
  riskScore: number;
  /** True when this estimate would trigger a total loss. */
  crossesThreshold: boolean;
}

export interface RebuttalComparison {
  acv: number;
  thresholdPct: number;
  /** ACV * thresholdPct/100 — the dollar line that declares a total loss. */
  thresholdAmount: number;
  pdr: RebuttalLineItem;
  conventional: RebuttalLineItem;
  /** conventional - pdr (dollars saved by repairing via PDR). */
  savings: number;
  /** Savings as a percentage of the conventional estimate. */
  savingsPct: number;
  /** Actionable recommendation derived from where each estimate lands. */
  recommendation: RebuttalRecommendation;
}

/**
 * Builds a side-by-side PDR vs. conventional cut/replace comparison used to
 * rebut a carrier's total-loss determination.
 *
 * @param pdrEstimate          PDR repair estimate (dollars).
 * @param conventionalEstimate Conventional cut/replace estimate (dollars).
 * @param acv                  Actual Cash Value (dollars, > 0).
 * @param thresholdPct         State threshold percentage (default 75).
 * @throws {TotalLossInputError} on invalid inputs.
 */
export function generateRebuttalComparison(
  pdrEstimate: number,
  conventionalEstimate: number,
  acv: number,
  thresholdPct = 75,
): RebuttalComparison {
  assertFinitePositive('pdrEstimate', pdrEstimate, true);
  assertFinitePositive('conventionalEstimate', conventionalEstimate, true);
  assertFinitePositive('acv', acv);
  assertFinitePositive('thresholdPct', thresholdPct);

  const thresholdAmount = acv * (thresholdPct / 100);

  const buildLine = (estimate: number): RebuttalLineItem => {
    const riskScore = calculateRiskScore(estimate, acv, thresholdPct);
    return {
      estimate: round2(estimate),
      pctOfAcv: round2((estimate / acv) * 100),
      riskScore,
      crossesThreshold: riskScore >= 1,
    };
  };

  const pdr = buildLine(pdrEstimate);
  const conventional = buildLine(conventionalEstimate);

  const savings = round2(conventionalEstimate - pdrEstimate);
  const savingsPct =
    conventionalEstimate > 0
      ? round2((savings / conventionalEstimate) * 100)
      : 0;

  // If PDR keeps the car repairable but conventional would total it, that's the
  // strongest rebuttal. If neither crosses, it's a normal repair. If PDR itself
  // crosses the threshold, the total loss is likely legitimate.
  let recommendation: RebuttalRecommendation;
  if (pdr.crossesThreshold) {
    recommendation = 'LIKELY_TOTAL_LOSS';
  } else if (conventional.crossesThreshold) {
    recommendation = 'PDR_REPAIR';
  } else {
    recommendation = 'REVIEW';
  }

  return {
    acv: round2(acv),
    thresholdPct,
    thresholdAmount: round2(thresholdAmount),
    pdr,
    conventional,
    savings,
    savingsPct,
    recommendation,
  };
}
