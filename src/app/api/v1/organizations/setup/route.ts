/**
 * PATCH /api/v1/organizations/setup
 *
 * Completes the onboarding gateway (/dashboard/setup): saves shop contact
 * details and records click-wrap acceptance of the MESH Terms of Service
 * (version, timestamp, accepting IP), then marks the organization
 * setup_completed.
 *
 * Runs as the caller's own session (Bearer token) rather than the service
 * role — `organizations_update` RLS already restricts this to the org's own
 * EXECUTIVE, which is exactly who should be completing setup.
 *
 * Body: { shopPhone, shopEmail, taxId }
 * Header: Authorization: Bearer <access_token>
 * 200: { success: true }
 * 400: { success: false, error }   (validation)
 * 401: { success: false, error }   (no/invalid session)
 * 403: { success: false, error }   (not the org's EXECUTIVE — RLS blocked the write)
 */
import { NextResponse } from 'next/server';
import { createSupabaseUserClient } from '@/lib/supabase';
import { getCurrentProfile } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOS_VERSION = 'v1.0-2026';

interface SetupBody {
  shopPhone?: string;
  shopEmail?: string;
  taxId?: string;
}

/** Best-effort client IP from standard proxy headers. */
function resolveClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') || 'unknown';
}

export async function PATCH(request: Request): Promise<Response> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) {
    return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });
  }

  let body: SetupBody = {};
  try {
    body = (await request.json()) as SetupBody;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const shopPhone = body.shopPhone?.trim() ?? '';
  const shopEmail = body.shopEmail?.trim().toLowerCase() ?? '';
  const taxId = body.taxId?.trim() ?? '';

  if (!shopPhone) {
    return NextResponse.json({ success: false, error: 'Shop phone is required.' }, { status: 400 });
  }
  if (!shopEmail || !EMAIL_RE.test(shopEmail)) {
    return NextResponse.json({ success: false, error: 'A valid shop email is required.' }, { status: 400 });
  }
  if (!taxId) {
    return NextResponse.json(
      { success: false, error: 'Tax ID / registration number is required.' },
      { status: 400 },
    );
  }

  try {
    const supabase = createSupabaseUserClient(token);

    const profile = await getCurrentProfile(supabase);
    if (!profile || !profile.organizationId) {
      return NextResponse.json(
        { success: false, error: 'No active session or organization found.' },
        { status: 401 },
      );
    }

    const { data, error } = await supabase
      .from('organizations')
      .update({
        shop_phone: shopPhone,
        shop_email: shopEmail,
        tax_id: taxId,
        tos_accepted_at: new Date().toISOString(),
        tos_version: TOS_VERSION,
        tos_accepted_ip: resolveClientIp(request),
        setup_completed: true,
      })
      .eq('id', profile.organizationId)
      .select('id')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      // RLS silently filtered the row rather than erroring — the caller isn't
      // the org's EXECUTIVE.
      return NextResponse.json(
        { success: false, error: 'Only the shop owner can complete setup for this organization.' },
        { status: 403 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Shop setup failed.' },
      { status: 400 },
    );
  }
}
