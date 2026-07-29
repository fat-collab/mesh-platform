/**
 * POST /api/v1/vapi/call
 *
 * Dispatches an outbound AI voice call to a carrier/adjuster for a claim.
 *
 * Request body (application/json):
 *   { phoneNumber: string, claimId?: string, objective?: CallObjective }
 *
 * Objective selects the Vapi assistant (per-objective env, with a default).
 * Response 200: { success, callId?, status?, provider, objective }.
 */
import { NextResponse } from 'next/server';
import { dispatchVapiCall } from '@/lib/vapi-client';
import { appendAuditEntry } from '@/lib/audit/ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OBJECTIVES = ['FOLLOW_UP_SUPPLEMENT', 'CHECK_ACV_STATUS', 'GENERAL'] as const;
type CallObjective = (typeof OBJECTIVES)[number];

function assistantFor(objective: CallObjective): string {
  const byObjective: Record<CallObjective, string | undefined> = {
    FOLLOW_UP_SUPPLEMENT: process.env.VAPI_ASSISTANT_SUPPLEMENT,
    CHECK_ACV_STATUS: process.env.VAPI_ASSISTANT_ACV,
    GENERAL: process.env.VAPI_ASSISTANT_ID,
  };
  return byObjective[objective] ?? process.env.VAPI_ASSISTANT_ID ?? 'mesh-default-assistant';
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const { phoneNumber, claimId, objective } = (body ?? {}) as {
    phoneNumber?: unknown;
    claimId?: unknown;
    objective?: unknown;
  };

  if (typeof phoneNumber !== 'string' || phoneNumber.trim().length === 0) {
    return NextResponse.json({ error: 'Field "phoneNumber" is required.' }, { status: 400 });
  }

  const obj = String(objective ?? 'GENERAL').toUpperCase();
  if (!OBJECTIVES.includes(obj as CallObjective)) {
    return NextResponse.json(
      { error: `Field "objective" must be one of: ${OBJECTIVES.join(', ')}.` },
      { status: 400 },
    );
  }
  const objectiveTyped = obj as CallObjective;

  const result = await dispatchVapiCall({
    phoneNumber: phoneNumber.trim(),
    assistantId: assistantFor(objectiveTyped),
    metadata: {
      claimId: typeof claimId === 'string' ? claimId : null,
      objective: objectiveTyped,
    },
  });

  // Record the outbound dispatch to the shared audit ledger.
  if (typeof claimId === 'string' && claimId.length > 0) {
    appendAuditEntry(claimId, {
      channel: 'VAPI_CALL',
      direction: 'OUTBOUND',
      summary: `AI follow-up call dispatched to ${phoneNumber.trim()} (${objectiveTyped}).`,
      status: result.success ? result.callId ?? result.status ?? 'queued' : 'failed',
      author: 'MESH',
    });
  }

  return NextResponse.json({ ...result, objective: objectiveTyped });
}
