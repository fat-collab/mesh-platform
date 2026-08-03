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
  //
  // userClient is also passed into convertLeadToRO itself below — that
  // function used to construct its own client internally
  // (getSupabaseBrowserClient(), which reads browser cookies), and a Route
  // Handler has no browser cookies for it to read. Left unfixed, every DB
  // call inside convertLeadToRO ran as an anonymous/no-session client, and
  // RLS silently returned zero rows for leads that genuinely existed —
  // "not found" with no error. Passing this session-bearing client (not a
  // service-role one) keeps RLS enforcing the caller's own org/role, rather
  // than bypassing it.
  let organizationId = '';
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const userClient = token ? createSupabaseUserClient(token) : undefined;
  if (userClient) {
    try {
      const profile = await getCurrentProfile(userClient);
      organizationId = profile?.organizationId ?? '';
    } catch {
      /* leave org empty → fallback */
    }
  }

  try {
    const roId = await convertLeadToRO(id, organizationId, userClient);
    return NextResponse.json({ success: true, roId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to convert lead.' },
      { status: 400 },
    );
  }
}
