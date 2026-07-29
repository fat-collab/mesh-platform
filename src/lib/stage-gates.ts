/**
 * MESH Ops — stage-gate enforcement.
 *
 * Blocks invalid repair-order stage transitions until procurement + financial
 * preconditions are met. Reads through parts-db / supplement-db, which are
 * DB-first with a session-local Map fallback — so the gate still evaluates
 * correctly when Supabase is offline (it just uses the local stores).
 *
 * NOTE: the `ro_stage` enum has no 'PAINT'/'REASSEMBLY' stages; those conceptual
 * names map onto the real forward repair/finish stages below, and are also
 * accepted verbatim as aliases so a caller using either label is still gated.
 */
import { getParts } from './parts-db';
import { getSupplementsForRO } from './supplement-db';

/**
 * Stages where all parts must be physically in-hand (Shipped / Received /
 * Returned) — i.e. the repair-execution & finish stages (PDR_REPAIR, ADAS_SUBLET,
 * QC_DELIVERY), plus the conceptual PAINT / REASSEMBLY aliases.
 */
const PARTS_GATE_STAGES = new Set<string>([
  'PDR_REPAIR',
  'ADAS_SUBLET',
  'QC_DELIVERY',
  'PAINT',
  'REASSEMBLY',
]);

/**
 * Stages "past teardown/body" that require financial clearance — no supplement
 * may still be open (DRAFT / SUBMITTED).
 */
const FINANCIAL_GATE_STAGES = new Set<string>([
  'PDR_REPAIR',
  'ADAS_SUBLET',
  'QC_DELIVERY',
  'PAINT',
  'REASSEMBLY',
]);

export interface StageTransitionResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Validates whether a repair order may transition to `targetStage`.
 * Returns `{ allowed: false, reason }` with the exact blocker when a gate trips.
 */
export async function validateStageTransition(
  repairOrderId: string,
  targetStage: string,
  claimNumber?: string,
): Promise<StageTransitionResult> {
  // Rule 1 — parts in-hand before repair / paint / reassembly.
  if (PARTS_GATE_STAGES.has(targetStage)) {
    const parts = await getParts(repairOrderId);
    const unready = parts.filter((p) => p.status === 'NEEDED' || p.status === 'ORDERED');
    if (unready.length > 0) {
      const names = unready.map((p) => p.partName).join(', ');
      return {
        allowed: false,
        reason: `Cannot advance to ${targetStage}: ${unready.length} part(s) not yet in-hand (${names}). Parts must be Shipped, Received, or Returned first.`,
      };
    }
  }

  // Rule 2 — financial clearance before moving past teardown/body.
  if (FINANCIAL_GATE_STAGES.has(targetStage)) {
    const supplements = await getSupplementsForRO(repairOrderId, claimNumber);
    const open = supplements.filter(
      (s) => s.lifecycleStatus === 'DRAFT' || s.lifecycleStatus === 'SUBMITTED',
    );
    if (open.length > 0) {
      return {
        allowed: false,
        reason: `Cannot advance to ${targetStage}: ${open.length} unresolved supplement(s) blocking financial clearance. Each must be carrier-approved (or resolved) first.`,
      };
    }
  }

  return { allowed: true };
}
