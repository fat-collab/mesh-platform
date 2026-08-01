/**
 * POST /api/v1/auth/register
 *
 * Self-service shop sign-up: provisions a brand-new tenant. Creates the
 * Supabase auth user, a new `organizations` row, and the linking `users` row
 * with role EXECUTIVE (the signing-up owner). There is no DB trigger that
 * auto-provisions `public.users` on `auth.users` insert, and RLS blocks a
 * fresh authenticated session from inserting into `organizations`/`users`
 * itself — so this route runs the whole sequence with the service-role client
 * and compensates (rolls back) if a later step fails, to avoid orphaned auth
 * users or empty organizations.
 *
 * Body: { email, password, fullName, organizationName, tosAccepted }
 * 200: { success: true, userId, organizationId }
 * 400: { success: false, error }   (validation, incl. tosAccepted !== true)
 * 409: { success: false, error }   (email already registered)
 * 500: { success: false, error }   (provisioning failed, rolled back)
 */
import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6; // matches supabase/config.toml minimum_password_length
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'MESH <onboarding@resend.dev>';
const TOS_VERSION = 'v1.0-2026';

/** Best-effort client IP from standard proxy headers. */
function resolveClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') || 'unknown';
}

function welcomeEmailHtml(fullName: string, organizationName: string): string {
  const firstName = fullName.split(' ')[0] || fullName;
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #18181b;">
      <h1 style="font-size: 20px; margin-bottom: 4px;">Welcome to MESH, ${firstName} 👋</h1>
      <p style="color: #52525b; font-size: 14px; line-height: 1.5;">
        <strong>${organizationName}</strong> is now live on MESH. Your Ops Cockpit is ready — here's how to get rolling:
      </p>
      <ol style="font-size: 14px; color: #27272a; line-height: 1.8; padding-left: 20px;">
        <li>Finish shop setup (contact details &amp; terms acceptance)</li>
        <li>Invite your team and assign roles</li>
        <li>Create your first repair order on the Ops board</li>
        <li>Connect a vendor and build your parts catalog</li>
      </ol>
      <p style="color: #52525b; font-size: 13px; margin-top: 24px;">
        Questions? Just reply to this email — we're happy to help you get set up.
      </p>
      <p style="color: #a1a1aa; font-size: 12px; margin-top: 24px;">— The MESH Team</p>
    </div>
  `;
}

const WELCOME_EMAIL_TIMEOUT_MS = 5000;

/**
 * Fires the welcome email. Failures are logged only — email delivery must
 * never roll back or block a successful account/organization creation.
 *
 * Two distinct Resend failure modes are handled, not just one:
 *  1. Thrown exceptions (network errors, a malformed SDK call) — caught below.
 *  2. Resend's SDK does NOT throw for API-level failures (invalid/missing API
 *     key, unverified domain, rate limits) — `.emails.send()` resolves to a
 *     `{ data, error }` tuple instead. Un-checked, a misconfigured key fails
 *     completely silently; the `error` branch below is what surfaces it.
 * A bounded timeout also guards against a slow/hanging Resend request holding
 * this serverless function open until the platform kills it — which would
 * drop the response entirely, even though the org/user rows already committed.
 */
async function sendWelcomeEmail(email: string, fullName: string, organizationName: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[register] RESEND_API_KEY not set — skipping welcome email.');
    return;
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), WELCOME_EMAIL_TIMEOUT_MS),
    );
    const result = await Promise.race([
      resend.emails.send({
        from: RESEND_FROM,
        to: email,
        subject: `Welcome to MESH — ${organizationName} is live`,
        html: welcomeEmailHtml(fullName, organizationName),
      }),
      timeout,
    ]);

    if (result === 'timeout') {
      console.warn(`[register] welcome email timed out after ${WELCOME_EMAIL_TIMEOUT_MS}ms — skipping.`);
      return;
    }
    if (result.error) {
      console.warn('[register] welcome email rejected by Resend:', result.error.name, result.error.message);
    }
  } catch (err) {
    console.warn('[register] welcome email failed to send:', err instanceof Error ? err.message : err);
  }
}

interface RegisterBody {
  email?: string;
  password?: string;
  fullName?: string;
  organizationName?: string;
  tosAccepted?: boolean;
}

export async function POST(request: Request): Promise<Response> {
  let body: RegisterBody = {};
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? '';
  const password = body.password ?? '';
  const fullName = body.fullName?.trim() ?? '';
  const organizationName = body.organizationName?.trim() ?? '';

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ success: false, error: 'A valid email is required.' }, { status: 400 });
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { success: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    );
  }
  if (!fullName) {
    return NextResponse.json({ success: false, error: 'Full name is required.' }, { status: 400 });
  }
  if (!organizationName) {
    return NextResponse.json(
      { success: false, error: 'Shop / organization name is required.' },
      { status: 400 },
    );
  }
  // Mandatory click-wrap — re-validated server-side; never trust a disabled
  // client button as the actual enforcement.
  if (body.tosAccepted !== true) {
    return NextResponse.json(
      { success: false, error: 'You must accept the Terms of Service to register.' },
      { status: 400 },
    );
  }

  const supabase = createSupabaseServerClient();

  // --- 1. Create the auth user ------------------------------------------
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no transactional email sender configured; sign in immediately
    user_metadata: { full_name: fullName },
  });

  if (createErr || !created?.user) {
    const already = /already.*registered|already.*exists/i.test(createErr?.message ?? '');
    return NextResponse.json(
      { success: false, error: already ? 'An account with this email already exists.' : (createErr?.message ?? 'Failed to create account.') },
      { status: already ? 409 : 400 },
    );
  }
  const authUserId = created.user.id;

  // --- 2. Create the organization, recording the click-wrap acceptance ----
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .insert({
      name: organizationName,
      tos_accepted_at: new Date().toISOString(),
      tos_version: TOS_VERSION,
      tos_accepted_ip: resolveClientIp(request),
    })
    .select('id')
    .single();

  if (orgErr || !org) {
    await supabase.auth.admin.deleteUser(authUserId); // compensate: no orphaned auth user
    return NextResponse.json(
      { success: false, error: `Failed to create organization: ${orgErr?.message ?? 'unknown error'}` },
      { status: 500 },
    );
  }
  const organizationId = (org as { id: string }).id;

  // --- 3. Link the profile (owner = EXECUTIVE) -----------------------------
  const { data: profile, error: userErr } = await supabase
    .from('users')
    .insert({
      auth_user_id: authUserId,
      organization_id: organizationId,
      role: 'EXECUTIVE',
      full_name: fullName,
      email,
    })
    .select('id')
    .single();

  if (userErr || !profile) {
    // compensate: remove the empty org and the orphaned auth user
    await supabase.from('organizations').delete().eq('id', organizationId);
    await supabase.auth.admin.deleteUser(authUserId);
    return NextResponse.json(
      { success: false, error: `Failed to create user profile: ${userErr?.message ?? 'unknown error'}` },
      { status: 500 },
    );
  }

  // Non-blocking: a failed send must not undo the account/org that already
  // committed successfully above.
  try {
    await sendWelcomeEmail(email, fullName, organizationName);
  } catch (err) {
    console.warn('[register] welcome email dispatch threw:', err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ success: true, userId: authUserId, organizationId });
}
