/**
 * MESH — carrier rebuttal-letter generation client.
 *
 * Calls the rebuttal engine (`/api/mesh/rebuttal`) to produce the full Federal
 * (Magnuson-Moss / FTC) + state statutory rebuttal text for a disputed claim.
 * Relocated out of a stray `app/rebuttals/page.tsx` (which broke the build by
 * being a route file with no default export) into this reusable helper.
 */

export interface RebuttalDisputedLineItem {
  description: string;
  deniedAmount: number;
  reason: string;
}

export interface RebuttalClaimData {
  repairOrderId: string;
  claimNumber: string;
  insurerName: string;
  disputedLineItems: RebuttalDisputedLineItem[];
  stateJurisdiction: string;
}

interface RebuttalResponse {
  success: boolean;
  data?: { rebuttalText: string };
  error?: string;
}

/**
 * Generates the statutory rebuttal text for a claim. Returns the letter text, or
 * null if generation failed (the error is logged for the caller to surface).
 */
export async function generateRebuttal(claimData: RebuttalClaimData): Promise<string | null> {
  try {
    const response = await fetch('/api/mesh/rebuttal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(claimData),
    });
    const result = (await response.json()) as RebuttalResponse;
    if (!response.ok || !result.success || !result.data) {
      throw new Error(result.error || 'Rebuttal generation failed.');
    }
    return result.data.rebuttalText;
  } catch (err: unknown) {
    console.error('Rebuttal generation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
