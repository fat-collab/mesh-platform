/**
 * MESH — Vapi outbound call dispatcher (server-side).
 *
 * Places an outbound AI voice call via the Vapi REST API. When VAPI_API_KEY is
 * absent it returns a deterministic mock result so local dev / testing never
 * breaks and no real call is placed.
 */

const VAPI_CALL_URL = 'https://api.vapi.ai/call';

export interface VapiDispatchParams {
  phoneNumber: string;
  assistantId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}

export interface VapiDispatchResult {
  success: boolean;
  callId?: string;
  status?: string;
  provider: string;
  error?: string;
}

export async function dispatchVapiCall({
  phoneNumber,
  assistantId,
  metadata = {},
}: VapiDispatchParams): Promise<VapiDispatchResult> {
  const apiKey = process.env.VAPI_API_KEY;

  // Deterministic offline fallback — no external call, stable id from the number.
  if (!apiKey) {
    const tail = phoneNumber.replace(/\D/g, '').slice(-4) || '0000';
    return { success: true, provider: 'mock', status: 'queued', callId: `mock-call-${tail}` };
  }

  try {
    const res = await fetch(VAPI_CALL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assistantId,
        ...(process.env.VAPI_PHONE_NUMBER_ID
          ? { phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID }
          : {}),
        customer: { number: phoneNumber },
        metadata,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { success: false, provider: 'vapi', error: `Vapi ${res.status}: ${text.slice(0, 200)}` };
    }

    const body = (await res.json().catch(() => ({}))) as { id?: string; status?: string };
    return { success: true, provider: 'vapi', callId: body.id, status: body.status };
  } catch (err) {
    return {
      success: false,
      provider: 'vapi',
      error: err instanceof Error ? err.message : 'Vapi request failed.',
    };
  }
}
