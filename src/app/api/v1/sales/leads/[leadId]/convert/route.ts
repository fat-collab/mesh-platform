/**
 * POST /api/v1/sales/leads/[leadId]/convert
 *
 * Converts an approved intake lead into an active Production RO on the Ops
 * board (via the sales DAL bridge) and returns the new RO id.
 *
 * Response 200: { success: true, roId: string }
 * Response 400: { error: string }   (e.g. lead not found)
 */
import { NextResponse } from 'next/server';
import { convertLeadToRO } from '@/lib/sales-db';
import { getCurrentProfile } from '@/lib/auth';
import { createSupabaseUserClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ leadId: string }> },
): Promise<Response> {
  const { leadId } = await params;
  const id = decodeURIComponent(leadId);

  // Resolve the caller's organization from their bearer token (RLS-scoped).
  // Absent/invalid → empty org; convertLeadToRO then uses its local fallback.
  let organizationId = '';
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (token) {
    try {
      const profile = await getCurrentProfile(createSupabaseUserClient(token));
      organizationId = profile?.organizationId ?? '';
    } catch {
      /* leave org empty → fallback */
    }
  }

  try {
    const roId = await convertLeadToRO(id, organizationId);
    return NextResponse.json({ success: true, roId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to convert lead.' },
      { status: 400 },
    );
  }
}
