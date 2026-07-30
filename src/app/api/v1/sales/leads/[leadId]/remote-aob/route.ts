/**
 * POST /api/v1/sales/leads/[leadId]/remote-aob
 *
 * Dispatches a Remote AOB Secure Signing Link to an off-site proxy
 * policyholder (Named Insured / Policyholder Match = No): creates the
 * tokenized link record and emails it via Resend, mirroring the
 * register route's send pattern (bounded timeout, both Resend failure modes
 * handled). There is no SMS provider wired into this app anywhere (only
 * Gemini vision and Vapi voice) — the "SMS dispatch" is best-effort logged
 * rather than actually sent, consistent with how this app mocks unconfigured
 * integrations instead of adding a new vendor dependency.
 *
 * Body: { proxy: { fullName, relationship?, phone?, email? } }
 * 200: { success: true, token: string, url: string }
 * 400: { error: string }
 */
import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createRemoteAobLink } from '@/lib/remote-aob-db';
import { markRemoteAobDispatched } from '@/lib/sales-db';
import type { ProxyPolicyholder } from '@/components/sales/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'MESH <onboarding@resend.dev>';
const EMAIL_TIMEOUT_MS = 5000;

function remoteAobEmailHtml(proxyName: string, url: string): string {
  const firstName = proxyName.split(' ')[0] || proxyName;
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #18181b;">
      <h1 style="font-size: 20px; margin-bottom: 4px;">Authorization needed, ${firstName}</h1>
      <p style="color: #52525b; font-size: 14px; line-height: 1.5;">
        You've been listed as the point of contact for a vehicle repair claim. Please review
        and sign the repair authorization (AOB) below so the shop can proceed with the work.
      </p>
      <p style="margin: 24px 0;">
        <a href="${url}" style="display:inline-block; background:#0284c7; color:#fff; padding:10px 20px; border-radius:6px; font-size:14px; text-decoration:none;">
          Review &amp; Sign Authorization
        </a>
      </p>
      <p style="color: #a1a1aa; font-size: 12px;">If you weren't expecting this, you can safely ignore this email.</p>
      <p style="color: #a1a1aa; font-size: 12px; margin-top: 24px;">— The MESH Team</p>
    </div>
  `;
}

/**
 * Fires the remote-AOB email. Mirrors sendWelcomeEmail's two-failure-mode
 * handling (thrown exceptions vs. Resend's non-throwing {data,error} tuple)
 * and bounded timeout so a slow Resend request can't hold this route open.
 */
async function sendRemoteAobEmail(to: string, proxyName: string, url: string): Promise<void> {
  if (!to) return;
  if (!process.env.RESEND_API_KEY) {
    console.warn('[remote-aob] RESEND_API_KEY not set — skipping email dispatch.');
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
        subject: 'Action required: sign your repair authorization',
        html: remoteAobEmailHtml(proxyName, url),
      }),
      timeout,
    ]);
    if (result === 'timeout') {
      console.warn(`[remote-aob] email timed out after ${EMAIL_TIMEOUT_MS}ms — skipping.`);
      return;
    }
    if (result.error) {
      console.warn('[remote-aob] email rejected by Resend:', result.error.name, result.error.message);
    }
  } catch (err) {
    console.warn('[remote-aob] email failed to send:', err instanceof Error ? err.message : err);
  }
}

/** No SMS provider exists anywhere in this app — mock-log the dispatch. */
function mockSendSms(to: string | undefined, url: string): void {
  if (!to) return;
  console.log(`[remote-aob] (mock SMS) would text ${to}: Please sign your repair authorization: ${url}`);
}

interface RemoteAobBody {
  proxy?: ProxyPolicyholder;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ leadId: string }> },
): Promise<Response> {
  const { leadId } = await params;
  const id = decodeURIComponent(leadId);

  let body: RemoteAobBody;
  try {
    body = (await request.json()) as RemoteAobBody;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const proxy = body.proxy;
  if (!proxy?.fullName?.trim()) {
    return NextResponse.json({ error: 'Proxy policyholder full name is required.' }, { status: 400 });
  }

  const { token } = await createRemoteAobLink(id, proxy);
  const origin = request.headers.get('origin') || new URL(request.url).origin;
  const url = `${origin}/remote-aob/${token}`;

  await sendRemoteAobEmail(proxy.email, proxy.fullName, url);
  mockSendSms(proxy.phone, url);
  await markRemoteAobDispatched(id, token);

  return NextResponse.json({ success: true, token, url });
}
