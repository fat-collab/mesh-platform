/**
 * POST /api/v1/secure-docs
 *
 * Issues a short-lived (60s) signed URL for a customer document in the private
 * 'secure-customer-docs' storage bucket, gated to privileged roles ('owner' /
 * 'general_manager'), and records the access in audit_logs.
 *
 * Body: { filePath, repairOrderId, userId, userRole }
 * 200: { success: true, signedUrl }
 * 403: { success: false, error }   (insufficient role)
 * 400 / 500: { success: false, error }
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Aligned with the insurance_payments RLS policy (EXECUTIVE / MANAGER).
const ALLOWED_ROLES = ['EXECUTIVE', 'MANAGER'];
const BUCKET = 'secure-customer-docs';
const SIGNED_URL_TTL_SECONDS = 60;

interface SecureDocBody {
  filePath?: string;
  repairOrderId?: string;
  userId?: string;
  userRole?: string;
}

export async function POST(request: Request): Promise<Response> {
  let body: SecureDocBody = {};
  try {
    body = (await request.json()) as SecureDocBody;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { filePath, repairOrderId, userId, userRole } = body;

  if (!filePath || !repairOrderId) {
    return NextResponse.json(
      { success: false, error: 'filePath and repairOrderId are required.' },
      { status: 400 },
    );
  }

  if (!userRole || !ALLOWED_ROLES.includes(userRole)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: Insufficient clearance level.' },
      { status: 403 },
    );
  }

  try {
    const supabase = createSupabaseServerClient();

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message || 'Failed to generate signed URL.');
    }

    // Append-only access trail. Best-effort: a logging failure must not deny an
    // already-authorized access (surfaced as a warning).
    const { error: auditErr } = await supabase.from('audit_logs').insert({
      user_id: userId ?? null,
      action: 'SECURE_DOC_ACCESS',
      target_id: repairOrderId,
      metadata: { filePath, bucket: BUCKET, userRole, ttlSeconds: SIGNED_URL_TTL_SECONDS },
    });
    if (auditErr) {
      console.warn('[secure-docs] audit log write failed:', auditErr.message);
    }

    return NextResponse.json({ success: true, signedUrl: data.signedUrl });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Secure document access failed.' },
      { status: 500 },
    );
  }
}
