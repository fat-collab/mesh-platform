'use server';

/**
 * Server Action for the fleet two-phase reservation hold.
 *
 * rental_vehicles' RLS is already permissive for the anon client (unlike
 * repair_orders), so this isn't working around a 403 — it's kept server-side
 * for consistency with intake-bridge.ts's Server Action pattern for
 * privileged-ish writes triggered from the sales pipeline.
 */
import { createSupabaseServerClient } from '@/lib/supabase-server';

export interface ReserveVehicleInput {
  vehicleId: string;
  /** Lead or RO id the reservation is held against. */
  leadOrRoId: string;
  customerName: string;
}

export interface ReserveVehicleResult {
  success: boolean;
  error?: string;
}

/**
 * Holds a vehicle for a lead without fabricating checkout data (mileage/fuel
 * aren't known until physical handoff) — sets RESERVED and binds
 * assigned_ro_id. Confirming pickup later (Fleet Command Center) transitions
 * RESERVED → RENTED with the real numbers via the existing assignVehicle().
 */
export async function reserveVehicleForLead(
  input: ReserveVehicleInput,
): Promise<ReserveVehicleResult> {
  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase
      .from('rental_vehicles')
      .update({
        status: 'RESERVED',
        assigned_ro_id: input.leadOrRoId,
        assigned_customer: input.customerName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.vehicleId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
