/**
 * PATCH /api/v1/repair-orders/[repairOrderId]/close
 *
 * Financial Clearance Gate — multi-vector ledger reconciliation. Closes the RO
 * only when ALL of the following pass; otherwise returns 422 with every active
 * blocker:
 *   1. Insurance ledger: sum(CLEARED insurance_payments) >= net liability
 *      (repair_orders.final_approved_amount - customer_deductible).
 *   2. Parts reconciled: 0 parts_line_items for the RO's claim with status != RECEIVED.
 *   3. Supplements settled: 0 supplement_records for the RO still unsettled.
 *   4. Rentals reconciled: 0 rental_reimbursements PENDING/PARTIAL — bypassable
 *      by an EXECUTIVE/MANAGER override (forceClose / overrideRentalBlock).
 * On pass it stamps financial_status='closed_paid' + closed_at.
 *
 * Schema notes: parts_line_items is keyed by claim_number (not repair_order_id),
 * so parts are scoped by the RO's claim. supplement_records has no `status`
 * column — it uses `lifecycle_status`; "pending" here means not yet PAID.
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const money = (n: number) => `$${n.toFixed(2)}`;
const OVERRIDE_ROLES = new Set(['EXECUTIVE', 'MANAGER']);

interface CloseBody {
  forceClose?: boolean;
  overrideRentalBlock?: boolean;
  userRole?: string;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ repairOrderId: string }> },
): Promise<Response> {
  const { repairOrderId } = await params;
  const id = decodeURIComponent(repairOrderId);

  let body: CloseBody = {};
  try {
    body = (await request.json()) as CloseBody;
  } catch {
    /* empty body allowed */
  }
  const overrideRequested = body.forceClose === true || body.overrideRentalBlock === true;
  const overrideAuthorized =
    overrideRequested && !!body.userRole && OVERRIDE_ROLES.has(body.userRole);

  try {
    const supabase = createSupabaseServerClient();

    // Repair order + liability inputs.
    const { data: ro, error: roErr } = await supabase
      .from('repair_orders')
      .select('id, claim_number, financial_status, final_approved_amount, customer_deductible')
      .eq('id', id)
      .maybeSingle();
    if (roErr) throw new Error(roErr.message);
    if (!ro) {
      return NextResponse.json(
        { success: false, error: `Repair order ${id} not found.` },
        { status: 404 },
      );
    }
    const record = ro as {
      id: string;
      claim_number: string | null;
      financial_status: string | null;
      final_approved_amount: number | null;
      customer_deductible: number | null;
    };

    if (record.financial_status === 'closed_paid') {
      return NextResponse.json({ success: true, message: `RO ${id} is already closed.` });
    }

    const claim = record.claim_number;
    const blockers: string[] = [];

    // --- Vector 1: insurance ledger ---------------------------------------
    const { data: payments, error: payErr } = await supabase
      .from('insurance_payments')
      .select('amount')
      .eq('repair_order_id', id)
      .eq('status', 'CLEARED');
    if (payErr) throw new Error(payErr.message);
    const totalInsuranceCleared = ((payments as { amount: number | null }[] | null) ?? []).reduce(
      (sum, p) => sum + (p.amount ?? 0),
      0,
    );
    const netLiability = (record.final_approved_amount ?? 0) - (record.customer_deductible ?? 0);
    if (totalInsuranceCleared < netLiability) {
      blockers.push(
        `insurance cleared ${money(totalInsuranceCleared)} below net liability ${money(netLiability)} (shortfall ${money(netLiability - totalInsuranceCleared)})`,
      );
    }

    // --- Vector 2: unreconciled parts (scoped by claim) -------------------
    if (claim) {
      const { data: parts, error: partsErr } = await supabase
        .from('parts_line_items')
        .select('id')
        .eq('claim_number', claim)
        .neq('status', 'RECEIVED');
      if (partsErr) throw new Error(partsErr.message);
      const unreconciledPartsCount = ((parts as { id: string }[] | null) ?? []).length;
      if (unreconciledPartsCount > 0) {
        blockers.push(`${unreconciledPartsCount} unreconciled part(s) (not RECEIVED)`);
      }
    }

    // --- Vector 3: pending (unsettled) supplements ------------------------
    const orFilter = claim ? `ro_id.eq.${id},claim_number.eq.${claim}` : `ro_id.eq.${id}`;
    const { data: supps, error: suppErr } = await supabase
      .from('supplement_records')
      .select('id')
      .or(orFilter)
      .neq('lifecycle_status', 'PAID');
    if (suppErr) throw new Error(suppErr.message);
    const pendingSupplementsCount = ((supps as { id: string }[] | null) ?? []).length;
    if (pendingSupplementsCount > 0) {
      blockers.push(`${pendingSupplementsCount} pending supplement(s)`);
    }

    // --- Vector 4: outstanding rental reimbursements (override-able) -------
    const { data: reimb, error: reimbErr } = await supabase
      .from('rental_reimbursements')
      .select('id')
      .eq('repair_order_id', id)
      .in('status', ['PENDING', 'PARTIAL']);
    if (reimbErr) throw new Error(reimbErr.message);
    const pendingReimbursements = ((reimb as { id: string }[] | null) ?? []).length;
    let rentalOverrideApplied = false;
    if (pendingReimbursements > 0) {
      if (overrideAuthorized) {
        rentalOverrideApplied = true; // logged on successful close; records kept active
      } else {
        blockers.push(
          'Closeout frozen: Outstanding rental reimbursements pending collection. Executive/Manager override required to bypass.',
        );
      }
    }

    // --- Gate --------------------------------------------------------------
    if (blockers.length > 0) {
      return NextResponse.json(
        { success: false, error: `Closeout blocked: ${blockers.join('; ')}.`, blockers },
        { status: 422 },
      );
    }

    // Record the managerial override (reimbursement records stay active for
    // backend collection tracking — the override only unblocks closeout).
    if (rentalOverrideApplied) {
      await supabase.from('audit_logs').insert({
        action: 'RENTAL_CLOSEOUT_OVERRIDE',
        target_id: id,
        metadata: {
          repairOrderId: id,
          overrideByRole: body.userRole,
          pendingReimbursements,
        },
      });
    }

    const { error: updErr } = await supabase
      .from('repair_orders')
      .update({ financial_status: 'closed_paid', closed_at: new Date().toISOString() })
      .eq('id', id);
    if (updErr) throw new Error(updErr.message);

    return NextResponse.json({
      success: true,
      message: `RO ${id} closed (closed_paid).${rentalOverrideApplied ? ' Rental reimbursement block overridden.' : ''}`,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Closeout authorization failed.' },
      { status: 400 },
    );
  }
}
