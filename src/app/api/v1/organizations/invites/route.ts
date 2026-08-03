/**
 * POST /api/v1/organizations/invites
 *
 * EXECUTIVE-only: invites an email address to join the caller's own
 * organization with a chosen role (any of the six public.user_role values,
 * including EXECUTIVE — the caller's decision, not a validation restriction
 * this route imposes). Generates a token, inserts the invite row, and emails
 * the accept link via Resend, mirroring register/route.ts's send pattern
 * exactly (bounded timeout, checks both Resend failure modes).
 *
 * EXECUTIVE is checked via getCurrentProfile before the insert is attempted,
 * not left to RLS alone — organization_invites_write would also block a
 * non-EXECUTIVE, but that surfaces as a zero-row PostgREST response with no
 * useful message. Checking here first means the caller gets an actual
 * "Only an EXECUTIVE can send invites" error instead of a mystery 403/404.
 *
 * Runs under the caller's own session (Bearer token), not service-role —
 * organization_invites_write RLS is the real backstop; this route's own
 * EXECUTIVE check just makes the common-error case legible.
 *
 * Body: { email, role }
 * Header: Authorization: Bearer <access_token>
 * 200: { success: true, token, url }
 * 400: { success: false, error }   (validation)
 * 401: { success: false, error }   (no/invalid session)
 * 403: { success: false, error }   (not an EXECUTIVE)
 * 409: { success: false, error }   (a PENDING invite already exists for this email)
 */
import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createSupabaseUserClient } from '@/lib/supabase';
import { getCurrentProfile } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'MESH <onboarding@resend.dev>';
const EMAIL_TIMEOUT_MS = 5000;
const INVITE_TTL_DAYS = 7;

// Must match public.user_role exactly (init_mesh.sql + 20260801035000's
// added SALES value). Not imported from database.types.ts — CLAUDE.md §6
// item 6 documents that file as stale; this list is the actual enum.
const VALID_ROLES = ['TECH', 'MANAGER', 'ADJUSTER', 'CUSTOMER', 'EXECUTIVE', 'SALES'] as const;
type InviteRole = (typeof VALID_ROLES)[number];

function isInviteRole(value: unknown): value is InviteRole {
  return typeof value === 'string' && (VALID_ROLES as readonly string[]).includes(value);
}

function genToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now()}${Math.round(Math.random() * 1e9)}`;
}

function inviteEmailHtml(organizationName: string, role: string, url: string): string {
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #18181b;">
      <h1 style="font-size: 20px; margin-bottom: 4px;">You've been invited to ${organizationName}</h1>
      <p style="color: #52525b; font-size: 14px; line-height: 1.5;">
        You've been invited to join <strong>${organizationName}</strong> on MESH as
        <strong>${role}</strong>. Click below to accept and set up your account.
      </p>
      <p style="margin: 24px 0;">
        <a href="${url}" style="display:inline-block; background:#0284c7; color:#fff; padding:10px 20px; border-radius:6px; font-size:14px; text-decoration:none;">
          Accept invite
        </a>
      </p>
      <p style="color: #a1a1aa; font-size: 12px;">This link expires in ${INVITE_TTL_DAYS} days. If you weren't expecting this, you can safely ignore this email.</p>
      <p style="color: #a1a1aa; font-size: 12px; margin-top: 24px;">— The MESH Team</p>
    </div>
  `;
}

/**
 * Fires the invite email. Mirrors sendWelcomeEmail / sendRemoteAobEmail's
 * two-failure-mode handling (thrown exceptions vs. Resend's non-throwing
 * {data,error} tuple) and bounded timeout. Failure here must never roll back
 * the invite row that already committed — the EXECUTIVE can always resend.
 */
async function sendInviteEmail(to: string, organizationName: string, role: string, url: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[organizations/invites] RESEND_API_KEY not set — skipping invite email.');
    return;
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), EMAIL_TIMEOUT_MS),
    );
    const result = await Promise.race([
      resend.emails.send({
        from: RESEND_FROM,
        to,
        subject: `You've been invited to join ${organizationName} on MESH`,
        html: inviteEmailHtml(organizationName, role, url),
      }),
      timeout,
    ]);
    if (result === 'timeout') {
      console.warn(`[organizations/invites] email timed out after ${EMAIL_TIMEOUT_MS}ms — skipping.`);
      return;
    }
    if (result.error) {
      console.warn('[organizations/invites] email rejected by Resend:', result.error.name, result.error.message);
    }
  } catch (err) {
    console.warn('[organizations/invites] email failed to send:', err instanceof Error ? err.message : err);
  }
}

interface InviteBody {
  email?: string;
  role?: string;
}

export async function POST(request: Request): Promise<Response> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) {
    return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });
  }

  let body: InviteBody = {};
  try {
    body = (await request.json()) as InviteBody;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? '';
  const role = body.role;

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ success: false, error: 'A valid email is required.' }, { status: 400 });
  }
  if (!isInviteRole(role)) {
    return NextResponse.json(
      { success: false, error: `Role must be one of: ${VALID_ROLES.join(', ')}.` },
      { status: 400 },
    );
  }

  const supabase = createSupabaseUserClient(token);

  const profile = await getCurrentProfile(supabase);
  if (!profile || !profile.organizationId) {
    return NextResponse.json({ success: false, error: 'No active session or organization found.' }, { status: 401 });
  }
  if (profile.role !== 'EXECUTIVE') {
    return NextResponse.json({ success: false, error: 'Only an EXECUTIVE can send invites.' }, { status: 403 });
  }

  // Pre-check for a nicer error than the partial-unique-index violation would
  // give — the index (organization_invites_org_email_pending_unique) is the
  // real backstop against the race, this is just a friendlier common case.
  const { data: existingPending } = await supabase
    .from('organization_invites')
    .select('id')
    .eq('organization_id', profile.organizationId)
    .eq('email', email)
    .eq('status', 'PENDING')
    .maybeSingle();
  if (existingPending) {
    return NextResponse.json(
      { success: false, error: 'An invite is already pending for this email. Revoke it before sending a new one.' },
      { status: 409 },
    );
  }

  // invited_by is informational (on delete set null) — resolve the caller's
  // own users.id, best-effort. A failure here must not block sending the
  // invite itself.
  let invitedBy: string | null = null;
  try {
    const { data: self } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', profile.authUserId)
      .maybeSingle();
    invitedBy = (self as { id: string } | null)?.id ?? null;
  } catch {
    /* best-effort */
  }

  const inviteToken = genToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error: insertError } = await supabase.from('organization_invites').insert({
    organization_id: profile.organizationId,
    email,
    role,
    token: inviteToken,
    invited_by: invitedBy,
    status: 'PENDING',
    expires_at: expiresAt,
  });

  if (insertError) {
    // 23505 = unique_violation — the partial-unique-index catching the race
    // the pre-check above couldn't fully close.
    const duplicate = (insertError as { code?: string }).code === '23505';
    return NextResponse.json(
      {
        success: false,
        error: duplicate
          ? 'An invite is already pending for this email. Revoke it before sending a new one.'
          : `Failed to create invite: ${insertError.message}`,
      },
      { status: duplicate ? 409 : 500 },
    );
  }

  const origin = request.headers.get('origin') || new URL(request.url).origin;
  const url = `${origin}/invite/${inviteToken}`;

  await sendInviteEmail(email, profile.organizationName || 'your team', role, url);

  return NextResponse.json({ success: true, token: inviteToken, url });
}
