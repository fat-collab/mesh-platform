/**
 * POST /api/v1/audit/log-reveal
 *
 * Records that a user unmasked a sensitive field (MaskedSensitiveField) into
 * audit_logs. Append-only privacy trail.
 *
 * Body: { repairOrderId, field, userId? }
 * 200: { success: true }
 * 400 / 500: { success: false, error }
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LogRevealBody {
  repairOrderId?: string;
  field?: string;
  userId?: string;
}

export async function POST(request: Request): Promise<Response> {
  let body: LogRevealBody = {};
  try {
    body = (await request.json()) as LogRevealBody;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { repairOrderId, field, userId } = body;
  if (!repairOrderId) {
    return NextResponse.json(
      { success: false, error: 'repairOrderId is required.' },
      { status: 400 },
    );
  }

  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.from('audit_logs').insert({
      user_id: userId ?? null,
      action: 'FIELD_REVEAL',
      target_id: repairOrderId,
      metadata: { field: field ?? null },
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Audit log write failed.' },
      { status: 500 },
    );
  }
}
