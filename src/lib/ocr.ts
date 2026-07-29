/**
 * MESH Platform — Check / remittance OCR via gemini-2.0-flash.
 *
 * Extracts the payable amount and claim identifier from a photographed check or
 * insurance remittance advice so Proof-of-Payment can be verified against the
 * repair order's claim number before any payout runs.
 */
import { GEMINI_MODEL, GeminiConfigError, Type, getGeminiClient } from './gemini';
import { clamp01 } from './image';

export class OcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrError';
  }
}

export { GeminiConfigError };

export interface CheckOcrResult {
  /** Payable amount in dollars, or null if unreadable. */
  checkAmount: number | null;
  /** Claim / reference number printed on the instrument, or null. */
  claimNumber: string | null;
  /** Check / draft number, or null. */
  checkNumber: string | null;
  /** Payer (issuing carrier / bank), or null. */
  payer: string | null;
  /** Model self-reported confidence, clamped to [0, 1]. */
  confidence: number;
}

const SYSTEM_INSTRUCTION = `You are a precise OCR engine reading a photographed physical check or an insurance remittance advice.

Extract exactly these fields:
- check_amount: the numeric payable amount in dollars (e.g. 5000.00). Read the courtesy (numeric) amount; if only the legal (written) amount is legible, convert it. Use null if you cannot read any amount.
- claim_number: the insurance claim number or reference/invoice number associated with the payment. It often appears in the memo line, a "RE:"/"CLAIM #" field, or the remittance stub. Preserve its characters exactly (letters, digits, dashes). Use null if none is present.
- check_number: the check/draft number, usually top-right. Use null if absent.
- payer: the issuing bank or insurance carrier name. Use null if unclear.
- confidence: your overall confidence from 0.0 to 1.0 that the amount and claim_number are correct.

Report only what is visibly printed. Do not invent values. Respond ONLY with the required JSON.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    check_amount: { type: Type.NUMBER, nullable: true },
    claim_number: { type: Type.STRING, nullable: true },
    check_number: { type: Type.STRING, nullable: true },
    payer: { type: Type.STRING, nullable: true },
    confidence: { type: Type.NUMBER },
  },
  required: ['check_amount', 'claim_number', 'confidence'],
  propertyOrdering: [
    'check_amount',
    'claim_number',
    'check_number',
    'payer',
    'confidence',
  ],
} as const;

function toNullableNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNullableString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 && s.toLowerCase() !== 'null' ? s : null;
}

/**
 * Runs OCR on a base64-encoded check/remittance image.
 *
 * @throws {GeminiConfigError} when GEMINI_API_KEY is not set.
 * @throws {OcrError} when the model call fails or returns unusable output.
 */
export async function extractCheckData(
  base64Data: string,
  mimeType: string,
): Promise<CheckOcrResult> {
  let rawText: string | undefined;
  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: 'Extract the payment fields from this check / remittance image.' },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
      },
    });
    rawText = response.text;
  } catch (err) {
    if (err instanceof GeminiConfigError) throw err;
    throw new OcrError(
      err instanceof Error ? `OCR request failed: ${err.message}` : 'OCR request failed.',
    );
  }

  if (!rawText) {
    throw new OcrError('OCR model returned an empty response.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new OcrError('OCR model returned malformed JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new OcrError('OCR model returned a non-object payload.');
  }

  const o = parsed as Record<string, unknown>;
  return {
    checkAmount: toNullableNumber(o.check_amount),
    claimNumber: toNullableString(o.claim_number),
    checkNumber: toNullableString(o.check_number),
    payer: toNullableString(o.payer),
    confidence: clamp01(Number(o.confidence)),
  };
}

/* -------------------------------------------------------------------------- */
/* Verification helpers                                                       */
/* -------------------------------------------------------------------------- */

/** Normalizes a claim number for comparison: uppercase, alphanumeric only. */
export function normalizeClaimNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface OcrVerification {
  verified: boolean;
  claimMatch: boolean;
  amountMatch: boolean;
  confidenceOk: boolean;
  reasons: string[];
}

export interface VerifyOcrOptions {
  expectedClaimNumber: string | null;
  expectedAmount: number;
  minConfidence?: number;
}

/**
 * Decides whether an OCR result verifies a payment against the expected claim
 * number and amount. All three checks (claim, amount, confidence) must pass.
 */
export function verifyCheckOcr(
  ocr: CheckOcrResult,
  opts: VerifyOcrOptions,
): OcrVerification {
  const minConfidence = opts.minConfidence ?? 0.5;
  const reasons: string[] = [];

  // Claim number must match the repair order's claim number.
  let claimMatch = false;
  if (!opts.expectedClaimNumber) {
    reasons.push('Repair order has no claim number to match against.');
  } else if (!ocr.claimNumber) {
    reasons.push('No claim number could be read from the document.');
  } else {
    claimMatch =
      normalizeClaimNumber(ocr.claimNumber) ===
      normalizeClaimNumber(opts.expectedClaimNumber);
    if (!claimMatch) {
      reasons.push(
        `Claim number mismatch (read "${ocr.claimNumber}", expected "${opts.expectedClaimNumber}").`,
      );
    }
  }

  // Amount must match within one cent or 0.5%, whichever is larger (OCR slack).
  let amountMatch = false;
  if (ocr.checkAmount == null) {
    reasons.push('No amount could be read from the document.');
  } else {
    const tolerance = Math.max(0.01, opts.expectedAmount * 0.005);
    amountMatch = Math.abs(ocr.checkAmount - opts.expectedAmount) <= tolerance;
    if (!amountMatch) {
      reasons.push(
        `Amount mismatch (read ${ocr.checkAmount}, expected ${opts.expectedAmount}).`,
      );
    }
  }

  const confidenceOk = ocr.confidence >= minConfidence;
  if (!confidenceOk) {
    reasons.push(
      `OCR confidence ${ocr.confidence.toFixed(2)} below threshold ${minConfidence}.`,
    );
  }

  return {
    verified: claimMatch && amountMatch && confidenceOk,
    claimMatch,
    amountMatch,
    confidenceOk,
    reasons,
  };
}
