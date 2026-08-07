/**
 * POST /api/v1/remote-aob/[token]/sign
 *
 * Replaces the remote signing page's previous two independent client-side
 * calls (signRemoteAobLink, then updateLeadStatus) with one server-side
 * request that performs both writes — remote_aob_links -> SIGNED, then
 * intake_leads.status -> AOB_SIGNED — so a failure between them is a single
 * 500 the client can safely retry, rather than two separate network
 * round-trips that can independently succeed or fail.
 *
 * Not a real Postgres transaction (still two separate UPDATE statements),
 * but resumable by construction: before writing anything, it reads the
 * link's current status and the lead's current status, and only performs
 * whichever write(s) haven't already happened. A retry after a partial
 * failure (link marked SIGNED, lead not yet advanced) completes just the
 * missing half instead of erroring on "already signed" or double-signing.
 *
 * Strictly token-keyed — lead_id is resolved server-side from
 * remote_aob_links, never accepted from the caller. Public, unauthenticated
 * by design (same posture as the signing page and remote_aob_links' own
 * RLS); uses a service-role client, so every input is treated as hostile.
 *
 * NOT done here, deliberately out of scope for this route: the auto-convert-
 * to-RO business rule (maybeAutoConvertOnAobSigned, in sales-db.ts) that
 * fires when updateLeadStatus's browser-client version runs. That function
 * is private and always resolves its own browser client internally — it
 * isn't built to accept an injected server client the way convertLeadToRO
 * now is, and extending it is a separate change. A remotely-signed lead
 * advances to AOB_SIGNED correctly and atomically via this route; it will
 * NOT auto-convert into a repair order the way the on-site wizard path
 * still does. Flagging this as a known gap, not silently dropping it.
 *
 * Body: { signatureDataUrl: string }
 * 200: { success: true }
 * 400: { error: string }   (bad token, missing signature, link not PENDING)
 * 404: { error: string }   (token or lead not found)
 * 500: { error: string }   (write failed — safe to retry)
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { assertPersistableDocumentUrl, genUuid, uploadDocumentBlob } from '@/lib/storage-upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOKEN_RE = /^[a-z0-9]{1,64}$/i;

interface SignBody {
  signatureDataUrl?: string;
}

interface LinkRow {
  lead_id: string;
  status: string;
  organization_id: string | null;
}

/** Parses a `data:<mime>;base64,<payload>` URL into raw bytes — no `fetch`
 *  dependency (Node's data: URL support varies by version), just a regex
 *  and Buffer, both guaranteed in this route's Node.js runtime. */
function decodeDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } | null {
  const match = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const [, contentType, base64] = match;
  try {
    return { buffer: Buffer.from(base64, 'base64'), contentType };
  } catch {
    return null;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  if (!token || !TOKEN_RE.test(token)) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 400 });
  }

  let body: SignBody;
  try {
    body = (await request.json()) as SignBody;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const signatureDataUrl = body.signatureDataUrl?.trim();

  const supabase = createSupabaseServerClient();

  const { data: linkData, error: linkFetchError } = await supabase
    .from('remote_aob_links')
    .select('lead_id, status, organization_id')
    .eq('token', token)
    .maybeSingle();
  if (linkFetchError || !linkData) {
    return NextResponse.json({ error: 'Signing link not found.' }, { status: 404 });
  }
  const link = linkData as unknown as LinkRow;

  if (link.status !== 'PENDING' && link.status !== 'SIGNED') {
    return NextResponse.json({ error: 'This signing link is no longer valid.' }, { status: 400 });
  }

  // First half: mark the link SIGNED, if not already (resumable — a retry
  // after a partial prior failure sees status already SIGNED and skips
  // straight to the second half below).
  if (link.status === 'PENDING') {
    if (!signatureDataUrl) {
      return NextResponse.json({ error: 'A signature is required.' }, { status: 400 });
    }
    if (!link.organization_id) {
      return NextResponse.json({ error: 'Signing link has no organization on file.' }, { status: 500 });
    }
    const decoded = decodeDataUrl(signatureDataUrl);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid signature data.' }, { status: 400 });
    }

    // Uploads via the same service-role `supabase` client already in scope
    // above — never getSupabaseBrowserClient(), which would try to attach
    // browser session state that doesn't exist for an anonymous signer.
    const pathWithoutExt = `${link.organization_id}/remote-aob/${token}/signature-${genUuid()}`;
    const signaturePath = await uploadDocumentBlob(supabase, pathWithoutExt, decoded.buffer, decoded.contentType);
    if (!signaturePath) {
      return NextResponse.json({ error: 'Failed to upload signature.' }, { status: 500 });
    }
    assertPersistableDocumentUrl(signaturePath);

    const now = new Date().toISOString();
    const { error: signError } = await supabase
      .from('remote_aob_links')
      .update({ status: 'SIGNED', signature_url: signaturePath, signed_at: now })
      .eq('token', token)
      .eq('status', 'PENDING');
    if (signError) {
      return NextResponse.json({ error: 'Failed to record signature.' }, { status: 500 });
    }
  }

  // Second half: advance the lead, if not already AOB_SIGNED (or already
  // further along — CONVERTED, etc. — in which case there's nothing to do).
  const { data: leadData, error: leadFetchError } = await supabase
    .from('intake_leads')
    .select('status')
    .eq('id', link.lead_id)
    .maybeSingle();
  if (leadFetchError || !leadData) {
    // The link is signed but the lead it points to is gone — surfacing this
    // as a server error rather than a silent 200 is deliberate: it's not a
    // state this flow expects to be able to resume from automatically.
    return NextResponse.json({ error: 'Signed, but the lead record could not be found.' }, { status: 500 });
  }
  const leadStatus = (leadData as { status: string }).status;

  if (leadStatus === 'NEW' || leadStatus === 'CONTACTED' || leadStatus === 'ESTIMATE_SENT') {
    const { error: statusError } = await supabase
      .from('intake_leads')
      .update({ status: 'AOB_SIGNED' })
      .eq('id', link.lead_id);
    if (statusError) {
      return NextResponse.json({ error: 'Signature recorded, but the lead status update failed.' }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
