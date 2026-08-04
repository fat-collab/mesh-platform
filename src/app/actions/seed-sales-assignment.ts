'use server';

/**
 * Server Action that seeds the initial SALES order_assignments row when a
 * lead converts into a repair order.
 *
 * SALES intentionally has NO write grant on order_assignments
 * (20260801020000_organization_scoped_rls.sql's order_assignments_write,
 * left untouched by 20260801060000_sales_role_access.sql on purpose — see
 * that migration's header comment) — that boundary stops reps from staffing
 * or reassigning technicians on the floor, and stays intact here. Recording
 * who converted a lead is not that: it's the system attributing an
 * application action, not a rep assigning staff. Hence this runs
 * server-side with the service-role client instead of loosening the RLS
 * grant, the same way bridgeRepairOrder (intake-bridge.ts) already does for
 * the repair_orders insert itself.
 *
 * Every DB call in this function uses createSupabaseServerClient() (service-
 * role) and ONLY that client — never call signInWithPassword or anything
 * else that establishes a session on it. A service-role client with
 * persistSession:false still holds an established session in memory once
 * one exists, and prefers it over the static key for every subsequent call
 * on that same instance — confirmed live earlier today: exactly this is
 * what silently downgraded the invite-accept route's service-role client to
 * an unprivileged session mid-request.
 */
import { createSupabaseServerClient, getSupabaseServerComponentClient } from '@/lib/supabase-server';

export interface SeedSalesAssignmentInput {
  repairOrderId: string;
  staffId: string | null;
  staffName: string;
}

export interface SeedSalesAssignmentResult {
  success: boolean;
  error?: string;
}

/**
 * Seeds a SALES order_assignments row for a repair order. Verifies the RO
 * is visible to the CALLER's own session first — via a separate, cookie-
 * bound client subject to normal RLS (repair_orders_select is org-scoped
 * with no role restriction, so any org member can see their own org's ROs),
 * not a client-supplied organization id. A repairOrderId the caller's
 * session can't SELECT is rejected, whether that's because it belongs to a
 * different organization or doesn't exist — the caller is never trusted to
 * have already checked this itself.
 */
export async function seedSalesAssignment(
  input: SeedSalesAssignmentInput,
): Promise<SeedSalesAssignmentResult> {
  const staffName = input.staffName.trim();
  if (!staffName) {
    return { success: false, error: 'staffName is required.' };
  }

  try {
    const callerClient = await getSupabaseServerComponentClient();
    const { data, error } = await callerClient
      .from('repair_orders')
      .select('id')
      .eq('id', input.repairOrderId)
      .maybeSingle();
    if (error || !data) {
      return { success: false, error: 'Repair order not found for the current session.' };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Could not verify caller session.',
    };
  }

  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.from('order_assignments').insert({
      repair_order_id: input.repairOrderId,
      staff_id: input.staffId,
      staff_name: staffName,
      role: 'SALES',
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
