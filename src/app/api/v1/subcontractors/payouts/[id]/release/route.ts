/**
 * POST|PATCH /api/v1/subcontractors/payouts/[id]/release
 *
 * Releases a 1099 subcontractor milestone payout — but only if the parent
 * repair order has cleared the master financial gate
 * (repair_orders.financial_status = 'closed_paid'). Otherwise the payout is
 * frozen (422). On release it stamps status='RELEASED' + released_at and writes
 * an audit_logs entry.
 *
 * 200: { success: true, message }
 * 422: { success: false, error }   (parent RO not cleared)
 * 404 / 400: { success: false, error }
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function releaseMilestone(id: string): Promise<Response> {
  try {
    const supabase = createSupabaseServerClient();

    // 1. Target milestone + parent RO.
    const { data: milestone, error: mErr } = await supabase
      .from('subcontractor_milestones')
      .select('id, repair_order_id, contractor_name, amount, status')
      .eq('id', id)
      .maybeSingle();
    if (mErr) throw new Error(mErr.message);
    if (!milestone) {
      return NextResponse.json(
        { success: false, error: `Milestone ${id} not found.` },
        { status: 404 },
      );
    }
    const ms = milestone as {
      id: string;
      repair_order_id: string | null;
      contractor_name: string;
      amount: number | null;
      status: string;
    };

    if (!ms.repair_order_id) {
      return NextResponse.json(
        { success: false, error: 'Milestone has no parent repair order.' },
        { status: 400 },
      );
    }

    // 2. Verify the parent RO's master financial gate.
    const { data: ro, error: roErr } = await supabase
      .from('repair_orders')
      .select('financial_status')
      .eq('id', ms.repair_order_id)
      .maybeSingle();
    if (roErr) throw new Error(roErr.message);
    if (!ro) {
      return NextResponse.json(
        { success: false, error: `Parent repair order ${ms.repair_order_id} not found.` },
        { status: 404 },
      );
    }
    const financialStatus = (ro as { financial_status: string | null }).financial_status;

    if (financialStatus !== 'closed_paid') {
      return NextResponse.json(
        {
          success: false,
          error: 'Payout frozen: Parent Repair Order has not cleared the master financial gate.',
        },
        { status: 422 },
      );
    }

    // 3. Release the milestone.
    const releasedAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('subcontractor_milestones')
      .update({ status: 'RELEASED', released_at: releasedAt })
      .eq('id', id);
    if (updErr) throw new Error(updErr.message);

    // 4. Audit trail (best-effort — never unwinds an authorized release).
    const { error: auditErr } = await supabase.from('audit_logs').insert({
      action: 'SUBCONTRACTOR_PAYOUT_RELEASED',
      target_id: id,
      metadata: {
        repairOrderId: ms.repair_order_id,
        contractorName: ms.contractor_name,
        amount: ms.amount ?? 0,
      },
    });
    if (auditErr) {
      console.warn('[payouts/release] audit log write failed:', auditErr.message);
    }

    return NextResponse.json({
      success: true,
      message: `Milestone ${id} released to ${ms.contractor_name}.`,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Payout release failed.' },
      { status: 400 },
    );
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return releaseMilestone(decodeURIComponent(id));
}

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return releaseMilestone(decodeURIComponent(id));
}
