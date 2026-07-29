/**
 * MESH Ops — automated workflow stage-gate evaluation.
 *
 * Validates RO workflow-status transitions against invoice / parts / labor,
 * read through the per-RO DALs (each DB-first with a session-local fallback).
 */
import { getInvoice } from './invoice-db';
import { getParts } from './parts-db';
import { getLaborEntries } from './labor-db';
import type { ROStatus, WorkflowValidationResult } from '@/components/ops/workflow-rules-types';

/** Returns whether an RO may transition to `targetStatus`, with the blocker. */
export async function validateStageTransition(
  repairOrderId: string,
  targetStatus: ROStatus,
): Promise<WorkflowValidationResult> {
  // Rule: parts allocated before work begins.
  if (targetStatus === 'IN_PROGRESS') {
    const parts = await getParts(repairOrderId);
    const unallocated = parts.filter((p) => p.status === 'NEEDED');
    if (unallocated.length > 0) {
      return {
        allowed: false,
        blockingRule: 'parts-allocated',
        reason: `Cannot start work: ${unallocated.length} part(s) not yet allocated (${unallocated
          .map((p) => p.partName)
          .join(', ')}). Parts must be at least Ordered.`,
      };
    }
  }

  // Rule: labor completed before quality control.
  if (targetStatus === 'QUALITY_CONTROL') {
    const labor = await getLaborEntries(repairOrderId);
    const openOps = labor.filter((l) => l.status !== 'COMPLETED');
    if (openOps.length > 0) {
      return {
        allowed: false,
        blockingRule: 'labor-complete',
        reason: `Cannot enter QC: ${openOps.length} labor operation(s) not completed (${openOps
          .map((l) => l.operationName)
          .join(', ')}).`,
      };
    }
  }

  // Rule: invoice PAID before delivery.
  if (targetStatus === 'DELIVERED') {
    const invoice = await getInvoice(repairOrderId);
    if (!invoice || invoice.status !== 'PAID') {
      return {
        allowed: false,
        blockingRule: 'invoice-paid',
        reason: `Cannot mark Delivered: invoice must be PAID (currently ${invoice?.status ?? 'no invoice'}).`,
      };
    }
  }

  return { allowed: true };
}
