/**
 * POST /api/v1/invites/[token]/accept
 *
 * Public, unauthenticated by design — same posture as the remote-AOB sign
 * route: the person accepting has no MESH session yet. Uses a service-role
 * client throughout, so every input is treated as hostile; strictly
 * token-keyed — organization_id and role are read from the invite row by
 * token and never accepted from the request body. There is no code path
 * here that reads either field out of `body` at all — that is what makes
 * self-assignment structurally impossible rather than merely rejected by a
 * check.
 *
 * Handles both branches with one body shape ({ fullName?, password }):
 *  - No auth account exists for the invite's email yet: creates one
 *    (auth.admin.createUser, email_confirm: true — same as register/route.ts,
 *    since there's no transactional-email confirmation flow configured).
 *  - An auth account already exists for that email (e.g. they have another
 *    MESH login, or a prior accept attempt got partway through): the
 *    supplied password is verified by actually signing in with it
 *    (auth.signInWithPassword), on a SEPARATE throwaway client — never on
 *    `supabase` (the service-role client used for every DB call below).
 *    Signing in on a client mutates its in-memory session, and once a
 *    session exists that client's requests silently switch from the
 *    service-role key to that session's own (unprivileged, org-less at this
 *    point) access token — `persistSession: false` only stops the session
 *    from being written to storage, it doesn't stop it from being used.
 *    Verified live: reusing `supabase` here caused every subsequent query
 *    (the org lookup, the users insert) to run as the invitee's own session
 *    instead of service-role, which RLS then correctly rejected (42501) —
 *    indistinguishable from a real RLS bug from the response alone. A wrong
 *    password fails closed (401) and mutates nothing — it does not burn the
 *    invite or reveal whether the account exists beyond what createUser's
 *    own error already implies.
 *
 * Resumable by construction, same technique as the remote-AOB sign route:
 * before writing anything, it establishes which of the three steps below
 * are already done and only performs what's missing, rather than assuming a
 * fresh run.
 *   1. Auth account exists for this email? (create, or verify-by-sign-in)
 *   2. A `public.users` row exists for that auth user? (insert if not —
 *      organization_id/role always come from the invite row fetched here,
 *      never from `body`)
 *   3. Invite marked ACCEPTED? (update if not)
 * A retry after a partial failure — e.g. the process died after step 1
 * succeeded but before step 2 committed — re-verifies the now-existing
 * account via the sign-in branch and completes steps 2–3. An invite already
 * fully ACCEPTED is not treated as a hard stop: replaying this endpoint
 * still requires knowing the account's real password (the sign-in-verify
 * branch), so there is no incremental risk in allowing the replay — anyone
 * who already knows the password already has full account access.
 *
 * The only hard stops are REVOKED and EXPIRED (the latter lazily set here,
 * or by GET /api/v1/invites/[token], whichever is read first past
 * expires_at) — those never proceed to any write.
 *
 * Body: { fullName?: string, password: string }
 * 200: { success: true }
 * 400: { error: string }   (bad token, missing/short password, revoked/expired invite)
 * 401: { error: string }   (wrong password for an existing account at this email)
 * 404: { error: string }   (invite not found)
 * 409: { error: string }   (email already belongs to a DIFFERENT organization)
 * 500: { error: string }   (write failed — safe to retry)
 */
import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { supabaseUrl, supabasePublishableKey } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOKEN_RE = /^[a-z0-9]{1,64}$/i;
const MIN_PASSWORD_LENGTH = 6; // matches register/route.ts + supabase/config.toml

interface AcceptBody {
  fullName?: string;
  password?: string;
}

interface InviteRow {
  organization_id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
}

interface ProfileRow {
  organization_id: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  if (!token || !TOKEN_RE.test(token)) {
    return NextResponse.json({ error: 'Invalid invite link.' }, { status: 400 });
  }

  let body: AcceptBody;
  try {
    body = (await request.json()) as AcceptBody;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const fullName = body.fullName?.trim() ?? '';
  const password = body.password ?? '';
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const supabase = createSupabaseServerClient();

  const { data: inviteData, error: inviteError } = await supabase
    .from('organization_invites')
    .select('organization_id, email, role, status, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (inviteError || !inviteData) {
    return NextResponse.json({ error: 'Invite not found.' }, { status: 404 });
  }
  const invite = inviteData as unknown as InviteRow;

  if (invite.status === 'REVOKED') {
    return NextResponse.json({ error: 'This invite has been revoked.' }, { status: 400 });
  }
  let status = invite.status;
  if (status === 'PENDING' && new Date(invite.expires_at).getTime() < Date.now()) {
    await supabase
      .from('organization_invites')
      .update({ status: 'EXPIRED' })
      .eq('token', token)
      .eq('status', 'PENDING');
    status = 'EXPIRED';
  }
  if (status === 'EXPIRED') {
    return NextResponse.json({ error: 'This invite has expired. Ask for a new one.' }, { status: 400 });
  }

  // --- Step 1: resolve the auth account (create, or verify-by-sign-in) -----
  let authUserId: string;
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  });

  if (!createErr && created?.user) {
    authUserId = created.user.id;
  } else {
    const already = /already.*registered|already.*exists/i.test(createErr?.message ?? '');
    if (!already) {
      return NextResponse.json(
        { error: createErr?.message ?? 'Failed to create account.' },
        { status: 500 },
      );
    }
    // Deliberately NOT `supabase` — signing in on the service-role client
    // would poison it with the invitee's own session for every subsequent
    // call in this request. This client is used once, for verification
    // only, and discarded.
    const verifyClient = createSupabaseClient(supabaseUrl, supabasePublishableKey, {
      auth: { persistSession: false },
    });
    const { data: signInData, error: signInError } = await verifyClient.auth.signInWithPassword({
      email: invite.email,
      password,
    });
    if (signInError || !signInData?.user) {
      return NextResponse.json(
        {
          error:
            'An account with this email already exists. Enter that account\'s password to accept the invite.',
        },
        { status: 401 },
      );
    }
    authUserId = signInData.user.id;
  }

  // --- Step 2: attach a users row, if one doesn't already exist -------------
  // organization_id and role come from `invite`, resolved above by token —
  // never from `body`.
  const { data: existingProfileData } = await supabase
    .from('users')
    .select('organization_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  const existingProfile = existingProfileData as unknown as ProfileRow | null;

  if (existingProfile) {
    if (existingProfile.organization_id !== invite.organization_id) {
      return NextResponse.json(
        { error: 'This email is already linked to a different MESH organization.' },
        { status: 409 },
      );
    }
    // Already attached to the right org — nothing to insert; fall through to
    // step 3 so a retry still confirms the invite is marked ACCEPTED.
  } else {
    const { error: profileInsertError } = await supabase.from('users').insert({
      auth_user_id: authUserId,
      organization_id: invite.organization_id,
      role: invite.role,
      full_name: fullName || null,
      email: invite.email,
    });
    if (profileInsertError) {
      return NextResponse.json(
        { error: `Signed in, but attaching your profile failed: ${profileInsertError.message}` },
        { status: 500 },
      );
    }
  }

  // --- Step 3: mark the invite ACCEPTED, if not already ----------------------
  if (status !== 'ACCEPTED') {
    await supabase
      .from('organization_invites')
      .update({ status: 'ACCEPTED', accepted_at: new Date().toISOString() })
      .eq('token', token)
      .eq('status', status);
  }

  return NextResponse.json({ success: true });
}
