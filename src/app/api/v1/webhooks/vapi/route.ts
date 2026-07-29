/**
 * POST /api/v1/webhooks/vapi
 *
 * Receives Vapi call events and appends call summaries / transcripts to the
 * target record's audit ledger with a precise UTC timestamp. The target record
 * id is read from the call metadata (`claimId`) we set at dispatch time.
 *
 * Handled message types: 'end-of-call-report' (summary + transcript),
 * 'status-update' (call status). Others are acknowledged and ignored.
 */
import { NextResponse } from 'next/server';
import { appendAuditEntry } from '@/lib/audit/ledger';
import { checkIdempotency, verifyVapiSecret } from '@/lib/webhooks/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** First non-null value found at any of the given key-paths. */
function pick(obj: any, ...paths: string[][]): any {
  for (const path of paths) {
    let cur = obj;
    for (const key of path) cur = cur == null ? undefined : cur[key];
    if (cur != null) return cur;
  }
  return undefined;
}

export async function POST(request: Request): Promise<Response> {
  // Read the raw body once — required for HMAC signature verification.
  const rawBody = await request.text();

  // Verify Vapi's native shared-secret header when configured (skipped in local
  // dev so the mock flow keeps working).
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (secret) {
    const check = verifyVapiSecret(request.headers.get('x-vapi-secret'), secret);
    if (!check.isValid) {
      return NextResponse.json({ error: check.error ?? 'Invalid secret.' }, { status: 401 });
    }
  }

  let payload: any;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const message = payload?.message ?? payload;
  const type = String(message?.type ?? 'unknown');

  // Idempotency: drop duplicate deliveries of the same call event.
  const callId = pick(message, ['call', 'id'], ['callId']);
  if (callId != null) {
    const marker = String(
      pick(message, ['timestamp']) ?? pick(message, ['status']) ?? pick(message, ['endedReason']) ?? '',
    );
    const eventId = `${type}:${callId}:${marker}`;
    if (!checkIdempotency(eventId)) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  const claimId = pick(
    message,
    ['call', 'metadata', 'claimId'],
    ['metadata', 'claimId'],
    ['call', 'assistantOverrides', 'metadata', 'claimId'],
  );
  if (typeof claimId !== 'string' || claimId.length === 0) {
    return NextResponse.json({ received: true, ignored: 'no claimId in call metadata' });
  }

  const nowUtc = new Date().toISOString();

  if (type === 'end-of-call-report') {
    const summary = String(pick(message, ['analysis', 'summary'], ['summary']) ?? 'Call completed.');
    const transcript = pick(message, ['transcript']);
    const status = String(
      pick(message, ['endedReason'], ['call', 'status'], ['status']) ?? 'completed',
    );
    appendAuditEntry(claimId, {
      channel: 'VAPI_CALL',
      direction: 'OUTBOUND',
      summary,
      transcript: typeof transcript === 'string' ? transcript : undefined,
      status,
      author: 'Vapi',
      timestamp: nowUtc,
    });
    return NextResponse.json({ received: true, logged: 'end-of-call-report' });
  }

  if (type === 'status-update') {
    const status = String(pick(message, ['status'], ['call', 'status']) ?? 'update');
    appendAuditEntry(claimId, {
      channel: 'VAPI_CALL',
      direction: 'OUTBOUND',
      summary: `Call status update: ${status}.`,
      status,
      author: 'Vapi',
      timestamp: nowUtc,
    });
    return NextResponse.json({ received: true, logged: 'status-update' });
  }

  return NextResponse.json({ received: true, ignored: type });
}
