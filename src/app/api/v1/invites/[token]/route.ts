/**
 * GET /api/v1/invites/[token]
 *
 * Public, unauthenticated by design — same posture as the remote-AOB summary
 * route: the person opening an invite link has no MESH session yet. Lets the
 * accept page (/invite/[token]) show who's inviting them and to what role
 * before they create/attach an account.
 *
 * Strictly token-keyed: the only input this route accepts is the token in
 * the URL, validated against a tight regex BEFORE any query — treat it as
 * hostile input, same as remote-aob's summary route. Uses a service-role
 * client, since the invitee has no organization_id yet for any RLS
 * predicate here to match.
 *
 * Lazily flips a PENDING-but-past-expires_at row to EXPIRED on read — there
 * is no cron job doing this, so the first lookup after expiry is what
 * actually marks it. Never mutates ACCEPTED/REVOKED rows.
 *
 * 200: { valid, organizationName, role, email, reason? }
 *      reason is present only when valid is false (EXPIRED | ACCEPTED | REVOKED).
 * 404: { error: string }   (bad token shape, or no invite matches it at all)
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Same shape genToken() in the invites POST route produces (32-char hex from
// crypto.randomUUID with dashes stripped, or a digits-only fallback) — bound
// tightly rather than forwarding whatever arrives straight into a query.
const TOKEN_RE = /^[a-z0-9]{1,64}$/i;

interface InviteRow {
  organization_id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  organizations: { name: string | null } | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  if (!token || !TOKEN_RE.test(token)) {
    return NextResponse.json({ error: 'Invalid invite link.' }, { status: 404 });
  }

  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from('organization_invites')
    .select('organization_id, email, role, status, expires_at, organizations ( name )')
    .eq('token', token)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json({ error: 'Invite not found.' }, { status: 404 });
  }
  const invite = data as unknown as InviteRow;

  let status = invite.status;
  if (status === 'PENDING' && new Date(invite.expires_at).getTime() < Date.now()) {
    await supabase.from('organization_invites').update({ status: 'EXPIRED' }).eq('token', token).eq('status', 'PENDING');
    status = 'EXPIRED';
  }

  const valid = status === 'PENDING';

  return NextResponse.json({
    valid,
    organizationName: invite.organizations?.name ?? null,
    role: invite.role,
    email: invite.email,
    ...(valid ? {} : { reason: status }),
  });
}
