'use server';

/**
 * Server Action for the intake-to-ops bridge's repair_orders insert.
 *
 * The browser's anon-key Supabase client 403s on `repair_orders` inserts
 * (RLS policy — see sales-db.ts's bridgeIntakeToOps history). This runs the
 * insert server-side with the service-role client instead, which bypasses
 * RLS the same way the existing API routes using createSupabaseServerClient
 * already do (see src/lib/supabase.ts).
 */
import { createSupabaseServerClient } from '@/lib/supabase';

export interface BridgeRepairOrderInput {
  /** Repair order id — must be a genUuid()-generated id (native Postgres
   *  `uuid` primary key; a prefixed id like 'ro-<uuid>' 400s with 22P02). */
  id: string;
  customerName: string;
  claimNumber: string | null;
  /** repair_orders.organization_id is NOT NULL — required for the insert to
   *  succeed (caller resolves this via sales-db.ts's resolveOrganizationId,
   *  same session-then-DB-default resolution convertLeadToRO already uses). */
  organizationId: string | null;
}

export interface BridgeRepairOrderResult {
  success: boolean;
  error?: string;
}

/** Inserts the initial INTAKE-stage repair_orders row for a bridged lead. */
export async function bridgeRepairOrder(
  input: BridgeRepairOrderInput,
): Promise<BridgeRepairOrderResult> {
  if (!input.organizationId) {
    return { success: false, error: 'No organization id available for repair_orders insert.' };
  }
  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.from('repair_orders').insert({
      id: input.id,
      organization_id: input.organizationId,
      customer_name: input.customerName,
      claim_number: input.claimNumber,
      stage: 'INTAKE',
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
