/**
 * POST /api/v1/insurance/cadence-check
 *
 * Insurance "No-Stall" protocol. Evaluates active (PENDING) insurance claims by
 * days since submitted_at and auto-escalates stalls:
 *   Day 3  → PENDING_NUDGE          (automated email dispatch)
 *   Day 5  → MANAGER_ESCALATED      (manager priority alert / voice trigger)
 *   Day 7+ → SUPERVISOR_ESCALATED   (formal carrier supervisor notice)
 * Fires only on an upward stall_status transition (no re-nudging the same tier),
 * bumps nudge_count + last_nudge_at, and logs each action to audit_logs.
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StallStatus = 'ACTIVE' | 'PENDING_NUDGE' | 'MANAGER_ESCALATED' | 'SUPERVISOR_ESCALATED';
const SEVERITY: Record<StallStatus, number> = {
  ACTIVE: 0,
  PENDING_NUDGE: 1,
  MANAGER_ESCALATED: 2,
  SUPERVISOR_ESCALATED: 3,
};

interface ClaimRow {
  id: string;
  repair_order_id: string | null;
  submitted_at: string | null;
  stall_status: StallStatus | null;
  nudge_count: number | null;
}

interface CadenceAction {
  id: string;
  repairOrderId: string | null;
  daysOutstanding: number;
  action: string;
  stallStatus: StallStatus;
}

export async function POST(): Promise<Response> {
  try {
    const supabase = createSupabaseServerClient();

    const { data, error } = await supabase
      .from('insurance_payments')
      .select('id, repair_order_id, submitted_at, stall_status, nudge_count')
      .eq('status', 'PENDING');
    if (error) throw new Error(error.message);
    const claims = (data as ClaimRow[] | null) ?? [];

    const now = Date.now();
    const actions: CadenceAction[] = [];

    for (const c of claims) {
      const submitted = c.submitted_at ? Date.parse(c.submitted_at) : now;
      const days = Math.floor((now - submitted) / 86_400_000);

      let target: StallStatus = 'ACTIVE';
      let label = '';
      if (days >= 7) {
        target = 'SUPERVISOR_ESCALATED';
        label = 'Day 7+ formal carrier supervisor notice';
      } else if (days >= 5) {
        target = 'MANAGER_ESCALATED';
        label = 'Day 5 manager priority alert / voice trigger';
      } else if (days >= 3) {
        target = 'PENDING_NUDGE';
        label = 'Day 3 automated email dispatch';
      }

      const current = c.stall_status ?? 'ACTIVE';
      if (!label || SEVERITY[target] <= SEVERITY[current]) continue;

      await supabase
        .from('insurance_payments')
        .update({
          stall_status: target,
          last_nudge_at: new Date().toISOString(),
          nudge_count: (c.nudge_count ?? 0) + 1,
        })
        .eq('id', c.id);

      await supabase.from('audit_logs').insert({
        action: 'INSURANCE_CADENCE_NUDGE',
        target_id: c.id,
        metadata: {
          repairOrderId: c.repair_order_id,
          daysOutstanding: days,
          action: label,
          stallStatus: target,
        },
      });

      actions.push({
        id: c.id,
        repairOrderId: c.repair_order_id,
        daysOutstanding: days,
        action: label,
        stallStatus: target,
      });
    }

    return NextResponse.json({
      success: true,
      evaluated: claims.length,
      actionsTaken: actions.length,
      actions,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Cadence check failed.' },
      { status: 500 },
    );
  }
}
