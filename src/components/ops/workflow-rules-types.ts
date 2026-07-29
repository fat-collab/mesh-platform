/**
 * MESH Ops — automated workflow stage-gate rules (RO-scoped).
 *
 * A higher-level workflow status distinct from the physical `ro_stage` board
 * enum; gated by automated rules evaluated against invoice / parts / labor.
 */

export type ROStatus =
  | 'INTAKE'
  | 'DIAGNOSIS'
  | 'APPROVAL'
  | 'IN_PROGRESS'
  | 'QUALITY_CONTROL'
  | 'READY'
  | 'DELIVERED';

export const RO_STATUS_LABEL: Record<ROStatus, string> = {
  INTAKE: 'Intake',
  DIAGNOSIS: 'Diagnosis',
  APPROVAL: 'Approval',
  IN_PROGRESS: 'In Progress',
  QUALITY_CONTROL: 'Quality Control',
  READY: 'Ready',
  DELIVERED: 'Delivered',
};

export const RO_STATUS_ORDER: ROStatus[] = [
  'INTAKE',
  'DIAGNOSIS',
  'APPROVAL',
  'IN_PROGRESS',
  'QUALITY_CONTROL',
  'READY',
  'DELIVERED',
];

export interface WorkflowValidationResult {
  allowed: boolean;
  reason?: string;
  blockingRule?: string;
}

export interface WorkflowRule {
  id: string;
  targetStatus: ROStatus;
  description: string;
}

/** Declarative gate config; evaluation lives in `lib/workflow-rules.ts`. */
export const WORKFLOW_RULES: WorkflowRule[] = [
  {
    id: 'parts-allocated',
    targetStatus: 'IN_PROGRESS',
    description: 'All parts must be allocated (ordered) or approved before work begins.',
  },
  {
    id: 'labor-complete',
    targetStatus: 'QUALITY_CONTROL',
    description: 'All labor operations must be completed before quality control.',
  },
  {
    id: 'invoice-paid',
    targetStatus: 'DELIVERED',
    description: 'Invoice must be PAID before the vehicle can be delivered.',
  },
];
