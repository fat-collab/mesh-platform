/**
 * /api/v1/ops/timeline
 *
 * GET  ?repairOrderId=…  → the RO's unified event stream (newest first).
 * POST { repairOrderId, eventType, description, metadata?, dispatch? }
 *      → logs a timeline event; when dispatch (or eventType 'AI_DISPATCH') is
 *        set, attaches an AI dispatch payload (vendor/adjuster follow-up).
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TimelinePostBody {
  repairOrderId?: string;
  eventType?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  dispatch?: boolean;
}

export async function GET(request: Request): Promise<Response> {
  const repairOrderId = new URL(request.url).searchParams.get('repairOrderId');
  if (!repairOrderId) {
    return NextResponse.json(
      { success: false, error: 'repairOrderId query param is required.' },
      { status: 400 },
    );
  }
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('ops_timelines')
      .select('*')
      .eq('repair_order_id', repairOrderId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, events: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to load timeline.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: TimelinePostBody = {};
  try {
    body = (await request.json()) as TimelinePostBody;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { repairOrderId, eventType, description, metadata, dispatch } = body;
  if (!repairOrderId || !eventType || !description) {
    return NextResponse.json(
      { success: false, error: 'repairOrderId, eventType and description are required.' },
      { status: 400 },
    );
  }

  try {
    const supabase = createSupabaseServerClient();

    // AI dispatch payload (queued follow-up) when requested.
    let dispatchPayload: Record<string, unknown> | null = null;
    if (dispatch || eventType === 'AI_DISPATCH') {
      dispatchPayload = {
        channel: (metadata?.channel as string) ?? 'email',
        target: (metadata?.target as string) ?? 'adjuster',
        template: (metadata?.template as string) ?? 'follow_up',
        queuedAt: new Date().toISOString(),
      };
    }

    const { data, error } = await supabase
      .from('ops_timelines')
      .insert({
        repair_order_id: repairOrderId,
        event_type: eventType,
        description,
        metadata: { ...(metadata ?? {}), ...(dispatchPayload ? { dispatch: dispatchPayload } : {}) },
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, event: data, dispatch: dispatchPayload });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to log timeline event.' },
      { status: 500 },
    );
  }
}
