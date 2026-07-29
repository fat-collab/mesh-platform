/**
 * MESH Platform — Stripe Connect payout / 1099 split ledger.
 *
 * Business rule D (CLAUDE.md): on Proof-of-Payment verification, split the
 * gross into three legs and transfer via Stripe Connect:
 *   50% PDR Lead Tech | 10% Sales | 40% House
 *
 * The "House" leg stays on the platform account, so it needs no transfer.
 * Tech and Sales legs are transferred to their connected Custom accounts.
 */
import Stripe from 'stripe';
import type { PayoutSplitRole } from './database.types';

export class StripeConfigError extends Error {
  constructor() {
    super('Missing environment variable: STRIPE_SECRET_KEY.');
    this.name = 'StripeConfigError';
  }
}

export class PayoutError extends Error {
  constructor(
    message: string,
    readonly role?: PayoutSplitRole,
  ) {
    super(message);
    this.name = 'PayoutError';
  }
}

let client: Stripe | undefined;

/**
 * Returns a memoized Stripe client.
 * @throws {StripeConfigError} when STRIPE_SECRET_KEY is not set.
 */
export function getStripeClient(): Stripe {
  if (client) return client;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new StripeConfigError();

  // apiVersion is intentionally left to the account default to avoid pinning
  // to a version the installed types may not know about.
  client = new Stripe(secretKey, {
    appInfo: { name: 'MESH Platform', version: '0.1.0' },
    typescript: true,
  });
  return client;
}

/* -------------------------------------------------------------------------- */
/* Split configuration (must sum to 100).                                     */
/* -------------------------------------------------------------------------- */
export interface SplitConfigEntry {
  role: PayoutSplitRole;
  pct: number;
  /** House keeps funds on-platform; no Connect transfer is created for it. */
  requiresTransfer: boolean;
}

export const PAYOUT_SPLIT_CONFIG: readonly SplitConfigEntry[] = [
  { role: 'PDR_LEAD', pct: 50, requiresTransfer: true },
  { role: 'SALES', pct: 10, requiresTransfer: true },
  { role: 'HOUSE', pct: 40, requiresTransfer: false },
];

const CONFIGURED_TOTAL = PAYOUT_SPLIT_CONFIG.reduce((s, e) => s + e.pct, 0);
if (CONFIGURED_TOTAL !== 100) {
  throw new Error(`PAYOUT_SPLIT_CONFIG must sum to 100 (got ${CONFIGURED_TOTAL}).`);
}

export interface PayoutSplitLeg {
  role: PayoutSplitRole;
  pct: number;
  /** Payout amount in whole dollars. */
  amount: number;
  /** Payout amount in integer cents (what Stripe expects). */
  amountCents: number;
  requiresTransfer: boolean;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Computes the three payout legs from a gross amount (dollars).
 *
 * Uses cent-based rounding and assigns any rounding remainder to the House leg
 * so the legs always sum exactly to the gross.
 *
 * @throws {PayoutError} when gross is not a finite, non-negative number.
 */
export function computePayoutSplits(grossAmount: number): PayoutSplitLeg[] {
  if (typeof grossAmount !== 'number' || !Number.isFinite(grossAmount) || grossAmount < 0) {
    throw new PayoutError('grossAmount must be a finite, non-negative number.');
  }

  const grossCents = dollarsToCents(grossAmount);

  const legs: PayoutSplitLeg[] = PAYOUT_SPLIT_CONFIG.map((entry) => {
    const amountCents = Math.floor((grossCents * entry.pct) / 100);
    return {
      role: entry.role,
      pct: entry.pct,
      amount: amountCents / 100,
      amountCents,
      requiresTransfer: entry.requiresTransfer,
    };
  });

  // Reconcile rounding: any leftover cents go to House (last, non-transfer leg).
  const allocated = legs.reduce((s, l) => s + l.amountCents, 0);
  const remainder = grossCents - allocated;
  if (remainder !== 0) {
    const house = legs.find((l) => l.role === 'HOUSE') ?? legs[legs.length - 1];
    house.amountCents += remainder;
    house.amount = house.amountCents / 100;
  }

  return legs;
}

/* -------------------------------------------------------------------------- */
/* Transfer execution.                                                        */
/* -------------------------------------------------------------------------- */
export interface PayoutRecipients {
  /** Connected account id for the PDR lead tech (acct_...). */
  pdrLeadAccountId: string;
  /** Connected account id for sales (acct_...). */
  salesAccountId: string;
}

export interface TransferResult {
  role: PayoutSplitRole;
  amountCents: number;
  status: 'PAID' | 'PENDING' | 'FAILED';
  /** Present when a Connect transfer was created. */
  stripeTransferId: string | null;
  /** Present on FAILED. */
  error?: string;
}

export interface ExecutePayoutParams {
  roId: string;
  grossAmount: number;
  recipients: PayoutRecipients;
  currency?: string;
  /** Idempotency scope; defaults to the RO id so retries don't double-pay. */
  idempotencyPrefix?: string;
}

export interface ExecutePayoutResult {
  transferGroup: string;
  legs: PayoutSplitLeg[];
  results: TransferResult[];
  allSucceeded: boolean;
}

/**
 * Executes the 50/10/40 split as Stripe Connect transfers.
 *
 * Each transferable leg is attempted independently with a stable idempotency
 * key so partial failures can be safely retried. The House leg is recorded as
 * PAID with no transfer (funds remain on-platform). Failures are captured per
 * leg rather than thrown, so the caller can persist ledger rows for every leg.
 */
export async function executePayoutSplits(
  params: ExecutePayoutParams,
): Promise<ExecutePayoutResult> {
  const { roId, grossAmount, recipients } = params;
  const currency = params.currency ?? 'usd';
  const idempotencyPrefix = params.idempotencyPrefix ?? roId;
  const transferGroup = `ro_${roId}`;

  if (!recipients?.pdrLeadAccountId || !recipients?.salesAccountId) {
    throw new PayoutError('Both pdrLeadAccountId and salesAccountId are required.');
  }

  const stripe = getStripeClient();
  const legs = computePayoutSplits(grossAmount);

  const destinationFor = (role: PayoutSplitRole): string | null => {
    switch (role) {
      case 'PDR_LEAD':
        return recipients.pdrLeadAccountId;
      case 'SALES':
        return recipients.salesAccountId;
      case 'HOUSE':
      default:
        return null;
    }
  };

  const results: TransferResult[] = [];

  for (const leg of legs) {
    const destination = destinationFor(leg.role);

    // House leg (or any leg without a destination): no transfer needed.
    if (!leg.requiresTransfer || !destination) {
      results.push({
        role: leg.role,
        amountCents: leg.amountCents,
        status: 'PAID',
        stripeTransferId: null,
      });
      continue;
    }

    if (leg.amountCents <= 0) {
      results.push({
        role: leg.role,
        amountCents: leg.amountCents,
        status: 'PAID',
        stripeTransferId: null,
      });
      continue;
    }

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: leg.amountCents,
          currency,
          destination,
          transfer_group: transferGroup,
          metadata: { ro_id: roId, split_role: leg.role },
        },
        { idempotencyKey: `${idempotencyPrefix}:${leg.role}` },
      );

      results.push({
        role: leg.role,
        amountCents: leg.amountCents,
        status: 'PAID',
        stripeTransferId: transfer.id,
      });
    } catch (err) {
      results.push({
        role: leg.role,
        amountCents: leg.amountCents,
        status: 'FAILED',
        stripeTransferId: null,
        error: err instanceof Error ? err.message : 'Unknown Stripe error.',
      });
    }
  }

  return {
    transferGroup,
    legs,
    results,
    allSucceeded: results.every((r) => r.status === 'PAID'),
  };
}
