/**
 * MESH — webhook security utilities.
 *
 * Two verification schemes:
 *   - verifyVapiSecret: Vapi's native shared-secret header (x-vapi-secret),
 *     constant-time equality. Use this for Vapi webhooks.
 *   - verifyWebhookSignature: HMAC-SHA256 of the raw body (Stripe-style), for
 *     providers/proxies that sign the payload.
 * Plus in-memory idempotency dedup.
 *
 * SERVER-ONLY (node:crypto). Back the idempotency set with Redis / a DB table
 * for multi-instance or durable dedup in production.
 */
import crypto from 'node:crypto';

const processedEventIds = new Set<string>();

export interface WebhookValidationResult {
  isValid: boolean;
  error?: string;
}

/** Validates Vapi's native shared-secret header using constant-time comparison. */
export function verifyVapiSecret(
  secretHeader: string | null,
  configuredSecret: string,
): WebhookValidationResult {
  if (!secretHeader) {
    return { isValid: false, error: 'Missing x-vapi-secret header' };
  }
  if (!configuredSecret) {
    return { isValid: false, error: 'Server Vapi secret not configured' };
  }

  try {
    const headerBuffer = Buffer.from(secretHeader, 'utf8');
    const secretBuffer = Buffer.from(configuredSecret, 'utf8');

    if (
      headerBuffer.length !== secretBuffer.length ||
      !crypto.timingSafeEqual(headerBuffer, secretBuffer)
    ) {
      return { isValid: false, error: 'Invalid x-vapi-secret header value' };
    }

    return { isValid: true };
  } catch (err) {
    return {
      isValid: false,
      error: `Vapi verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Validates an incoming webhook signature using HMAC SHA-256 (constant-time). */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): WebhookValidationResult {
  if (!signatureHeader) {
    return { isValid: false, error: 'Missing signature header' };
  }

  try {
    const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const providedBuffer = Buffer.from(signatureHeader, 'utf8');
    const computedBuffer = Buffer.from(digest, 'utf8');

    if (
      providedBuffer.length !== computedBuffer.length ||
      !crypto.timingSafeEqual(providedBuffer, computedBuffer)
    ) {
      return { isValid: false, error: 'Invalid webhook signature' };
    }

    return { isValid: true };
  } catch (err) {
    return {
      isValid: false,
      error: `Signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Ensures idempotency by rejecting duplicate event ids. Returns false on dupes. */
export function checkIdempotency(eventId: string): boolean {
  if (processedEventIds.has(eventId)) {
    return false; // Duplicate event, reject.
  }

  processedEventIds.add(eventId);

  // Prune oldest entries to prevent unbounded growth in long-running processes.
  if (processedEventIds.size > 10000) {
    const iterator = processedEventIds.values();
    for (let i = 0; i < 2000; i++) {
      const val = iterator.next().value;
      if (val !== undefined) {
        processedEventIds.delete(val);
      }
    }
  }

  return true;
}
