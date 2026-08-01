'use server';

/**
 * Server Action for the Ops-side mobile dispatch workflow.
 *
 * Ops Workflow Realignment: field deployment decisions (dispatching a mobile
 * technician to a customer's residence) move from Sales reps to Ops/Shop
 * Managers. Still operates on intake_leads — dispatch happens pre-conversion,
 * while a lead sits in Triage & Routing, the same timing as before; only the
 * trigger surface and write path moved (DispatchButton, gated to
 * MANAGER/EXECUTIVE, replacing the "Dispatch Mobile" control that used to
 * live on Sales' RoutingActionPanel).
 */
import { createSupabaseServerClient } from '@/lib/supabase-server';
import type { DispatchStatus } from '@/components/sales/types';

const LEADS_TABLE = 'intake_leads';

export interface DispatchMobileUnitInput {
  leadId: string;
  agentName: string;
}

export interface AdvanceDispatchStatusInput {
  leadId: string;
  status: DispatchStatus;
}

export interface DispatchActionResult {
  success: boolean;
  error?: string;
}

/** Routes a lead to a mobile house call and starts its dispatch lifecycle. */
export async function dispatchMobileUnit(
  input: DispatchMobileUnitInput,
): Promise<DispatchActionResult> {
  const agentName = input.agentName.trim();
  if (!agentName) return { success: false, error: 'Field agent name is required.' };
  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase
      .from(LEADS_TABLE)
      .update({
        routing_path: 'MOBILE_HOUSE_CALL',
        dispatch_staff_name: agentName,
        dispatch_status: 'DISPATCHED',
      })
      .eq('id', input.leadId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/** Advances an already-dispatched lead's field lifecycle. */
export async function advanceDispatchStatus(
  input: AdvanceDispatchStatusInput,
): Promise<DispatchActionResult> {
  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase
      .from(LEADS_TABLE)
      .update({ dispatch_status: input.status })
      .eq('id', input.leadId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
