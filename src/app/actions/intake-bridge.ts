'use server';

/**
 * Server Action for the intake-to-ops bridge's repair_orders insert.
 *
 * The browser's anon-key Supabase client 403s on `repair_orders` inserts
 * (RLS policy — see sales-db.ts's bridgeIntakeToOps history). This runs the
 * insert server-side with the service-role client instead, which bypasses
 * RLS the same way the existing API routes using createSupabaseServerClient
 * already do (see src/lib/supabase.ts).
 *
 * Idempotent per lead via intake_leads.repair_order_id (see
 * 20260805000000_intake_leads_repair_order_link.sql): if this lead already
 * has a linked RO — set by an earlier call to this same action, possibly
 * from a different session/process — that RO is adopted and returned
 * instead of inserting a second one. This is what closes the gap that
 * previously let convertLeadToRO's independent repair_orders insert collide
 * with repair_orders_org_claim_unique when it ran in a different runtime
 * than the bridgeIntakeToOps call that already created the RO (confirmed
 * live during sales-rep-ownership testing, lead 'Pamela Anderson').
 */
import { createSupabaseServerClient } from '@/lib/supabase-server';

export interface BridgeRepairOrderInput {
  /** Repair order id to use IF a new row is inserted — must be a
   *  genUuid()-generated id (native Postgres `uuid` primary key; a prefixed
   *  id like 'ro-<uuid>' 400s with 22P02). Ignored (an existing linked RO's
   *  own id is returned instead) when this lead already has one — the
   *  caller must use `result.roId`, not assume its own `id` was used. */
  id: string;
  /** The lead being bridged — required to check/set the durable link. */
  leadId: string;
  customerName: string;
  claimNumber: string | null;
  /** repair_orders.organization_id is NOT NULL — required for the insert to
   *  succeed (caller resolves this via sales-db.ts's resolveOrganizationId,
   *  same session-then-DB-default resolution convertLeadToRO already uses). */
  organizationId: string | null;
}

export interface BridgeRepairOrderResult {
  success: boolean;
  /** The RO id actually in effect: `input.id` if newly created, or an
   *  existing linked RO's id if adopted. Only present on success. */
  roId?: string;
  /** true if an existing linked RO was reused instead of inserting one. */
  adopted?: boolean;
  error?: string;
}

/** Inserts the initial INTAKE-stage repair_orders row for a bridged lead —
 *  or adopts one that's already durably linked, if this lead has one. */
export async function bridgeRepairOrder(
  input: BridgeRepairOrderInput,
): Promise<BridgeRepairOrderResult> {
  if (!input.organizationId) {
    return { success: false, error: 'No organization id available for repair_orders insert.' };
  }
  try {
    const supabase = createSupabaseServerClient();

    const { data: existingLead, error: existingLeadError } = await supabase
      .from('intake_leads')
      .select('repair_order_id')
      .eq('id', input.leadId)
      .maybeSingle();
    const existingRoId = !existingLeadError
      ? (existingLead as { repair_order_id: string | null } | null)?.repair_order_id
      : null;
    if (existingRoId) {
      return { success: true, roId: existingRoId, adopted: true };
    }

    const { error } = await supabase.from('repair_orders').insert({
      id: input.id,
      organization_id: input.organizationId,
      customer_name: input.customerName,
      claim_number: input.claimNumber,
      stage: 'INTAKE',
    });
    if (error) return { success: false, error: error.message };

    // Best-effort link-back — the RO itself is already created; a failed
    // write here just means a future call might not see the link (and could
    // create a second RO, the exact gap this migration exists to close),
    // not a lost repair order.
    const { error: linkError } = await supabase
      .from('intake_leads')
      .update({ repair_order_id: input.id })
      .eq('id', input.leadId);
    if (linkError) {
      console.warn(
        `[bridgeRepairOrder] failed to link lead ${input.leadId} to RO ${input.id}:`,
        linkError.message,
      );
    }

    return { success: true, roId: input.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
