/**
 * MESH Ops — repair-order labor & technician time tracking (RO-scoped).
 *
 * One RO → many labor operations, each with an assigned technician, estimated
 * vs. actual hours, a work status, and clock-in/out timestamps. Feeds the shop
 * efficiency ratio (estimated ÷ actual) in the drawer labor panel.
 */

export type LaborStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

export const LABOR_STATUS_LABEL: Record<LaborStatus, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
};

export const LABOR_STATUS_ORDER: LaborStatus[] = ['PENDING', 'IN_PROGRESS', 'COMPLETED'];

export interface RepairOrderLaborEntry {
  id: string;
  repairOrderId: string;
  operationName: string;
  technicianName: string;
  estimatedHours: number;
  actualHours: number;
  status: LaborStatus;
  clockedInAt?: string;
  clockedOutAt?: string;
  createdAt: string;
}

/** A labor entry enriched with its repair order context (for the tech hub). */
export interface ActiveLaborLine {
  entry: RepairOrderLaborEntry;
  repairOrderId: string;
  claimNumber: string | null;
  vehicle: string;
}
