/**
 * MESH — shop profile & SOP configuration types.
 * Client-safe (no runtime deps); the persistent store lives in src/lib/shop-config.ts.
 */

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
}

/** Per-technician PDR matrix rate cells by coin-size dent category. */
export interface PdrMatrixRow {
  id: string;
  technician: string;
  dime: number;
  nickel: number;
  quarter: number;
  halfDollar: number;
}

export interface OperatingHours {
  weekdays: string;
  saturday: string;
  sunday: string;
}

export interface ShopConfig {
  shopName: string;
  addressLine: string;
  city: string;
  /** 2-letter state — drives statutory prompt-payment rules. */
  state: string;
  zip: string;
  /** Tax ID / EIN. */
  taxId: string;
  operatingHours: OperatingHours;
  /** Digital engagement agreement acceptance (required). */
  engagementAccepted: boolean;
  staff: StaffMember[];
  pdrMatrix: PdrMatrixRow[];
  /** Whether this shop maintains its own loaner/rental fleet. Defaults to
   *  true when unset, so existing shops keep today's fleet-reservation flow.
   *  Partner/independent shops without a fleet toggle this off so the Shop
   *  Drop-off routing action skips vehicle allocation entirely. */
  hasFleet?: boolean;
  updatedAt?: string;
}

export const STAFF_ROLES: readonly string[] = [
  'TECH',
  'PDR_TECH',
  'ESTIMATOR',
  'SALES',
  'MANAGER',
  'ADJUSTER',
  'EXECUTIVE',
];
