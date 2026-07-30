/**
 * MESH Sales — Agreement Auto-Population Engine.
 *
 * Pure functions that bind captured lead/vault metadata into repair &
 * rental agreement generation. No React/DOM — safe on client or server.
 */
import type { IntakeDocumentRef, ProxyPolicyholder } from '@/components/sales/types';

export interface RentalOperatorBinding {
  name: string;
  phone: string;
  email: string;
  relationship: string | null;
  /** 'PROXY' when an off-site proxy is the on-site driver taking possession
   *  of the loaner instead of the absent Named Insured; 'POLICYHOLDER'
   *  otherwise (default path — customer at intake is the Named Insured). */
  source: 'PROXY' | 'POLICYHOLDER';
  /** Whether a driver's license (front or back) has been captured in the
   *  vault for the bound operator. */
  licenseOnFile: boolean;
}

/**
 * Binds the Rental Fleet Agreement to whoever is actually taking possession
 * of the loaner. An absent Named Insured can't be held liable for a vehicle
 * they'll never drive — when a proxy is operating on their behalf, the
 * agreement instead binds to the proxy's own driver's license and contact
 * info for liability compliance.
 */
export function resolveRentalOperator(input: {
  policyholderMatch?: boolean;
  proxyPolicyholder?: ProxyPolicyholder | null;
  customerName: string;
  phone: string;
  email: string;
  documents: Partial<Record<'DL_FRONT' | 'DL_BACK', IntakeDocumentRef | null>>;
}): RentalOperatorBinding {
  const licenseOnFile = Boolean(input.documents.DL_FRONT || input.documents.DL_BACK);

  if (input.policyholderMatch === false && input.proxyPolicyholder?.fullName?.trim()) {
    const p = input.proxyPolicyholder;
    return {
      name: p.fullName.trim(),
      phone: p.phone?.trim() ?? '',
      email: p.email?.trim() ?? '',
      relationship: p.relationship?.trim() || null,
      source: 'PROXY',
      licenseOnFile,
    };
  }

  return {
    name: input.customerName,
    phone: input.phone,
    email: input.email,
    relationship: null,
    source: 'POLICYHOLDER',
    licenseOnFile,
  };
}
