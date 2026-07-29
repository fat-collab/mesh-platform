/**
 * POST /api/v1/payments/verify
 *
 * Proof-of-Payment (PoP) verification + 1099 payout split ledger.
 *
 * Flow (business rule D):
 *   1. Authenticate the caller (Bearer token) and require MANAGER/EXECUTIVE.
 *   2. Validate the target repair order belongs to the caller's organization.
 *   3. Record the payment in `proof_of_payments` (ocr_verified_flag = true).
 *   4. Split the gross 50/10/40 and log rows into `payout_splits`, executing
 *      Stripe Connect transfers when connected-account ids are supplied.
 *   5. Advance the repair order to QC_DELIVERY when payment requirements are
 *      met and no hold gate is active.
 *
 * Request body (application/json):
 *   {
 *     "repair_order_id": "<uuid>",              // required
 *     "amount": 5000.00,                        // required, gross dollars
 *     "payment_method": "CHECK",                // required (echoed, not stored)
 *     "image": "https://.../check.jpg" | "<base64>", // required (URL persisted; base64 not stored)
 *     "recipients": {                           // optional; enables real transfers
 *       "pdrLeadAccountId": "acct_...",
 *       "salesAccountId": "acct_..."
 *     },
 *     "pdr_lead_user_id": "<uuid>"              // optional; tags the PDR_LEAD split row
 *   }
 *
 * SCHEMA NOTES:
 *   - `proof_of_payments` has no status/payment_method columns; the spec's
 *     "OCR_VERIFIED" status maps to ocr_verified_flag = true, and payment_method
 *     is echoed in the response but not persisted.
 *   - `payout_splits.net_payout` and child `organization_id` are set by triggers.
 */
import { NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  createSupabaseUserClient,
} from '@/lib/supabase';
import {
  PayoutError,
  StripeConfigError,
  computePayoutSplits,
  executePayoutSplits,
  type ExecutePayoutResult,
  type PayoutRecipients,
  type PayoutSplitLeg,
} from '@/lib/stripe';
import {
  extractCheckData,
  verifyCheckOcr,
  GeminiConfigError,
  OcrError,
  type CheckOcrResult,
  type OcrVerification,
} from '@/lib/ocr';
import { ImageResolveError, isHttpUrl, resolveImageInput } from '@/lib/image';
import type {
  PayoutSplit,
  PayoutSplitRole,
  PayoutStatus,
  RoStage,
  TablesInsert,
} from '@/lib/database.types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TransactionStatus = 'COMPLETED' | 'PARTIAL' | 'PENDING' | 'FAILED';

interface SplitBreakdownItem {
  role: PayoutSplitRole;
  tech_split_pct: number;
  net_payout: number;
  status: PayoutStatus;
  stripe_transfer_id: string | null;
  payout_split_id: string;
}

interface OcrSummary {
  performed: boolean;
  check_amount: number | null;
  claim_number: string | null;
  confidence: number;
  claim_match: boolean;
  amount_match: boolean;
}

interface VerifyResponse {
  proof_of_payment_id: string;
  repair_order_id: string;
  payment_method: string;
  amount: number;
  status: 'OCR_VERIFIED';
  transaction_status: TransactionStatus;
  transfers_executed: boolean;
  ocr: OcrSummary;
  split_breakdown: SplitBreakdownItem[];
  stage: {
    previous: RoStage;
    current: RoStage;
    updated: boolean;
    note?: string;
  };
}

function ocrSummary(
  performed: boolean,
  result: CheckOcrResult | null,
  verification: OcrVerification | null,
): OcrSummary {
  return {
    performed,
    check_amount: result?.checkAmount ?? null,
    claim_number: result?.claimNumber ?? null,
    confidence: result?.confidence ?? 0,
    claim_match: verification?.claimMatch ?? false,
    amount_match: verification?.amountMatch ?? false,
  };
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

const PRIVILEGED_ROLES = new Set(['MANAGER', 'EXECUTIVE']);

/** Maps a stripe leg status onto the payout_splits enum. */
function toPayoutStatus(s: 'PAID' | 'PENDING' | 'FAILED'): PayoutStatus {
  return s;
}

export async function POST(request: Request): Promise<Response> {
  /* -- 1. Parse + validate body ------------------------------------------- */
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Request body must be valid JSON.', 400);
  }
  if (typeof body !== 'object' || body === null) {
    return jsonError('Request body must be a JSON object.', 400);
  }

  const {
    repair_order_id,
    amount,
    payment_method,
    image,
    mime_type,
    skip_ocr,
    recipients,
    pdr_lead_user_id,
  } = body as {
    repair_order_id?: unknown;
    amount?: unknown;
    payment_method?: unknown;
    image?: unknown;
    mime_type?: unknown;
    skip_ocr?: unknown;
    recipients?: unknown;
    pdr_lead_user_id?: unknown;
  };

  if (typeof repair_order_id !== 'string' || repair_order_id.trim().length === 0) {
    return jsonError('Field "repair_order_id" (uuid) is required.', 400);
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return jsonError('Field "amount" must be a positive number (gross dollars).', 400);
  }
  const paymentMethod =
    typeof payment_method === 'string' && payment_method.trim().length > 0
      ? payment_method.trim()
      : 'CHECK';
  if (typeof image !== 'string' || image.trim().length === 0) {
    return jsonError('Field "image" (URL or base64) is required.', 400);
  }
  const leadUserId =
    typeof pdr_lead_user_id === 'string' && pdr_lead_user_id.trim().length > 0
      ? pdr_lead_user_id.trim()
      : null;
  const skipOcr = skip_ocr === true;
  const mimeHint =
    typeof mime_type === 'string' && mime_type.length > 0 ? mime_type : 'image/jpeg';

  // Recipients are optional. When present, real Connect transfers run; when
  // absent, splits are logged as PENDING for later execution.
  let payoutRecipients: PayoutRecipients | null = null;
  if (recipients != null) {
    const r = recipients as { pdrLeadAccountId?: unknown; salesAccountId?: unknown };
    if (
      typeof r.pdrLeadAccountId !== 'string' ||
      typeof r.salesAccountId !== 'string' ||
      r.pdrLeadAccountId.length === 0 ||
      r.salesAccountId.length === 0
    ) {
      return jsonError(
        'When provided, "recipients" must include pdrLeadAccountId and salesAccountId.',
        400,
      );
    }
    payoutRecipients = {
      pdrLeadAccountId: r.pdrLeadAccountId,
      salesAccountId: r.salesAccountId,
    };
  }

  const checkImageUrl = isHttpUrl(image) ? image.trim() : null;

  /* -- 2. Authenticate + authorize ---------------------------------------- */
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  if (!token) {
    return jsonError('Missing Bearer access token.', 401);
  }

  let admin;
  let callerOrgId: string;
  try {
    const userClient = createSupabaseUserClient(token);
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData?.user) {
      return jsonError('Invalid or expired access token.', 401);
    }

    admin = createSupabaseServerClient();
    const { data: profile, error: profileError } = await admin
      .from('users')
      .select('id, organization_id, role')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();

    if (profileError) {
      return jsonError('Failed to resolve user profile.', 500, {
        detail: profileError.message,
      });
    }
    if (!profile) {
      return jsonError('No MESH user profile for this account.', 403);
    }
    if (!PRIVILEGED_ROLES.has(profile.role)) {
      return jsonError('Only MANAGER or EXECUTIVE may verify payments.', 403);
    }
    callerOrgId = profile.organization_id;
  } catch (err) {
    return jsonError('Authentication failed.', 500, {
      detail: err instanceof Error ? err.message : undefined,
    });
  }

  /* -- 3. Load + authorize the repair order ------------------------------- */
  const { data: ro, error: roError } = await admin
    .from('repair_orders')
    .select('id, organization_id, stage, hold_gate_active, claim_number')
    .eq('id', repair_order_id)
    .maybeSingle();

  if (roError) {
    return jsonError('Failed to load repair order.', 500, { detail: roError.message });
  }
  if (!ro || ro.organization_id !== callerOrgId) {
    // Do not distinguish "not found" from "other tenant" to avoid leaking ids.
    return jsonError('Repair order not found.', 404);
  }

  // Idempotency: refuse to double-process an RO that already has a ledger.
  const { data: existingSplits, error: existingError } = await admin
    .from('payout_splits')
    .select('id')
    .eq('ro_id', ro.id)
    .limit(1);

  if (existingError) {
    return jsonError('Failed to check existing payouts.', 500, {
      detail: existingError.message,
    });
  }
  if (existingSplits && existingSplits.length > 0) {
    return jsonError('A payout ledger already exists for this repair order.', 409);
  }

  /* -- 3b. OCR the document + cross-check the claim ----------------------- */
  let ocrResult: CheckOcrResult | null = null;
  let verification: OcrVerification | null = null;
  let ocrVerified = true; // skip_ocr trusts the caller-supplied amount

  if (!skipOcr) {
    let resolved: { data: string; mime: string };
    try {
      resolved = await resolveImageInput(image, mimeHint);
    } catch (err) {
      if (err instanceof ImageResolveError) {
        return jsonError(err.message, 400);
      }
      return jsonError('Failed to load payment image.', 400, {
        detail: err instanceof Error ? err.message : undefined,
      });
    }

    try {
      ocrResult = await extractCheckData(resolved.data, resolved.mime);
    } catch (err) {
      if (err instanceof GeminiConfigError) {
        return jsonError('OCR engine is not configured. Pass skip_ocr to bypass.', 503);
      }
      if (err instanceof OcrError) {
        return jsonError('OCR failed to read the document.', 502, { detail: err.message });
      }
      return jsonError('OCR failed.', 502, {
        detail: err instanceof Error ? err.message : undefined,
      });
    }

    verification = verifyCheckOcr(ocrResult, {
      expectedClaimNumber: ro.claim_number,
      expectedAmount: amount,
    });
    ocrVerified = verification.verified;
  }

  /* -- 4. Record proof of payment ----------------------------------------- */
  const popInsert: TablesInsert<'proof_of_payments'> = {
    ro_id: ro.id,
    check_amount: amount,
    check_image_url: checkImageUrl,
    ocr_verified_flag: ocrVerified,
  };

  const { data: pop, error: popError } = await admin
    .from('proof_of_payments')
    .insert(popInsert)
    .select('id')
    .single();

  if (popError || !pop) {
    return jsonError('Failed to record proof of payment.', 500, {
      detail: popError?.message,
    });
  }

  // OCR could not verify the payment: record it, but do NOT pay out or advance.
  if (!ocrVerified) {
    return NextResponse.json(
      {
        proof_of_payment_id: pop.id,
        repair_order_id: ro.id,
        status: 'OCR_UNVERIFIED',
        transaction_status: 'FAILED' as TransactionStatus,
        ocr: ocrSummary(true, ocrResult, verification),
        reasons: verification?.reasons ?? [],
      },
      { status: 422 },
    );
  }

  /* -- 5. Compute + (optionally) execute payout splits -------------------- */
  let legs: PayoutSplitLeg[];
  let execResult: ExecutePayoutResult | null = null;
  let transfersExecuted = false;

  try {
    if (payoutRecipients) {
      execResult = await executePayoutSplits({
        roId: ro.id,
        grossAmount: amount,
        recipients: payoutRecipients,
        idempotencyPrefix: pop.id,
      });
      legs = execResult.legs;
      transfersExecuted = true;
    } else {
      legs = computePayoutSplits(amount);
    }
  } catch (err) {
    if (err instanceof StripeConfigError) {
      return jsonError('Payout processor is not configured.', 503, {
        proof_of_payment_id: pop.id,
      });
    }
    if (err instanceof PayoutError) {
      return jsonError(err.message, 400, { proof_of_payment_id: pop.id });
    }
    return jsonError('Failed to compute payout splits.', 500, {
      proof_of_payment_id: pop.id,
      detail: err instanceof Error ? err.message : undefined,
    });
  }

  // Resolve per-leg status + transfer id (defaulting to PENDING when no transfer ran).
  const legStatus = (role: PayoutSplitRole): PayoutStatus => {
    const r = execResult?.results.find((x) => x.role === role);
    return r ? toPayoutStatus(r.status) : 'PENDING';
  };
  const legTransferId = (role: PayoutSplitRole): string | null =>
    execResult?.results.find((x) => x.role === role)?.stripeTransferId ?? null;

  const splitRows: TablesInsert<'payout_splits'>[] = legs.map((leg) => ({
    ro_id: ro.id,
    tech_user_id: leg.role === 'PDR_LEAD' ? leadUserId : null,
    split_role: leg.role,
    gross_amount: amount,
    tech_split_pct: leg.pct,
    stripe_transfer_id: legTransferId(leg.role),
    status: legStatus(leg.role),
  }));

  const { data: insertedSplits, error: splitError } = await admin
    .from('payout_splits')
    .insert(splitRows)
    .select('id, split_role, tech_split_pct, net_payout, status, stripe_transfer_id');

  if (splitError || !insertedSplits) {
    return jsonError('Payment recorded but failed to write payout ledger.', 500, {
      proof_of_payment_id: pop.id,
      detail: splitError?.message,
    });
  }

  const split_breakdown: SplitBreakdownItem[] = (insertedSplits as PayoutSplit[]).map(
    (row) => ({
      role: (row.split_role ?? 'HOUSE') as PayoutSplitRole,
      tech_split_pct: row.tech_split_pct,
      net_payout: row.net_payout ?? 0,
      status: row.status,
      stripe_transfer_id: row.stripe_transfer_id,
      payout_split_id: row.id,
    }),
  );

  // Derive an overall transaction status.
  let transaction_status: TransactionStatus;
  if (!transfersExecuted) {
    transaction_status = 'PENDING';
  } else if (execResult?.allSucceeded) {
    transaction_status = 'COMPLETED';
  } else if (execResult?.results.some((r) => r.status === 'PAID')) {
    transaction_status = 'PARTIAL';
  } else {
    transaction_status = 'FAILED';
  }

  /* -- 6. Advance the repair order stage ---------------------------------- */
  const previousStage = ro.stage as RoStage;
  let currentStage = previousStage;
  let stageUpdated = false;
  let stageNote: string | undefined;

  const requirementsSatisfied =
    transaction_status === 'COMPLETED' || transaction_status === 'PENDING';

  if (!requirementsSatisfied) {
    stageNote = 'Payout transfers failed; stage unchanged.';
  } else if (ro.hold_gate_active) {
    // Business rule C: cannot advance out of an active hold gate.
    stageNote = 'Active hold gate; resolve it before advancing to QC_DELIVERY.';
  } else if (previousStage === 'QC_DELIVERY') {
    stageNote = 'Repair order already at QC_DELIVERY.';
  } else {
    const { error: stageError } = await admin
      .from('repair_orders')
      .update({ stage: 'QC_DELIVERY' })
      .eq('id', ro.id);

    if (stageError) {
      stageNote = `Stage update failed: ${stageError.message}`;
    } else {
      currentStage = 'QC_DELIVERY';
      stageUpdated = true;
    }
  }

  /* -- 7. Respond --------------------------------------------------------- */
  const responseBody: VerifyResponse = {
    proof_of_payment_id: pop.id,
    repair_order_id: ro.id,
    payment_method: paymentMethod,
    amount,
    status: 'OCR_VERIFIED',
    transaction_status,
    transfers_executed: transfersExecuted,
    ocr: ocrSummary(!skipOcr, ocrResult, verification),
    split_breakdown,
    stage: {
      previous: previousStage,
      current: currentStage,
      updated: stageUpdated,
      note: stageNote,
    },
  };

  return NextResponse.json(responseBody, { status: 201 });
}
