/**
 * PATCH /api/v1/organizations/setup
 *
 * Completes the onboarding gateway (/dashboard/setup): saves/confirms shop
 * details, then marks the organization setup_completed.
 *
 * Terms-of-Service click-wrap acceptance is NOT recorded here — the Legal
 * Shield UI has moved upstream to registration (Phase 1 refactor). This route
 * deliberately no longer writes tos_accepted_at/tos_version/tos_accepted_ip,
 * since doing so with no consent UI on this page would fabricate a compliance
 * record for something the user never actually saw/accepted at this step.
 *
 * Runs as the caller's own session (Bearer token) rather than the service
 * role — `organizations_update` RLS already restricts this to the org's own
 * EXECUTIVE, which is exactly who should be completing setup.
 *
 * Body: { shopName, shopPhone, shopEmail, taxId }
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

interface SetupBody {
  shopName?: string;
  shopPhone?: string;
  shopEmail?: string;
  taxId?: string;
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

  const shopName = body.shopName?.trim() ?? '';
  const shopPhone = body.shopPhone?.trim() ?? '';
  const shopEmail = body.shopEmail?.trim().toLowerCase() ?? '';
  const taxId = body.taxId?.trim() ?? '';

  if (!shopName) {
    return NextResponse.json({ success: false, error: 'Shop name is required.' }, { status: 400 });
  }
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
        name: shopName,
        shop_phone: shopPhone,
        shop_email: shopEmail,
        tax_id: taxId,
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
