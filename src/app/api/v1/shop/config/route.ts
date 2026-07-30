/**
 * /api/v1/shop/config
 *
 * GET  → returns the saved shop configuration (or null).
 * POST → validates and saves/updates shop settings: name, address/state (for
 *        statutory prompt-payment rules), tax ID/EIN, operating hours,
 *        engagement-agreement acceptance, staff roster, and PDR tech matrix.
 */
import { NextResponse } from 'next/server';
import { getShopConfig, saveShopConfig } from '@/lib/shop-config';
import type {
  OperatingHours,
  PdrMatrixRow,
  ShopConfig,
  StaffMember,
} from '@/components/onboarding/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function genId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

function normalizeStaff(input: unknown): StaffMember[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      return {
        id: str(o.id) || genId('staff'),
        name: str(o.name),
        role: str(o.role) || 'TECH',
        email: str(o.email),
        phone: str(o.phone),
      };
    })
    .filter((s) => s.name.length > 0);
}

function normalizeMatrix(input: unknown): PdrMatrixRow[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      return {
        id: str(o.id) || genId('pdr'),
        technician: str(o.technician),
        dime: num(o.dime),
        nickel: num(o.nickel),
        quarter: num(o.quarter),
        halfDollar: num(o.halfDollar),
      };
    })
    .filter((m) => m.technician.length > 0);
}

function normalizeHours(input: unknown): OperatingHours {
  const o = (input ?? {}) as Record<string, unknown>;
  return {
    weekdays: str(o.weekdays),
    saturday: str(o.saturday),
    sunday: str(o.sunday),
  };
}

export async function GET(): Promise<Response> {
  return NextResponse.json({ config: getShopConfig() });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const config: ShopConfig = {
    shopName: str(b.shopName),
    addressLine: str(b.addressLine),
    city: str(b.city),
    state: str(b.state).toUpperCase(),
    zip: str(b.zip),
    taxId: str(b.taxId),
    operatingHours: normalizeHours(b.operatingHours),
    engagementAccepted: b.engagementAccepted === true,
    staff: normalizeStaff(b.staff),
    pdrMatrix: normalizeMatrix(b.pdrMatrix),
    // Absent/undefined defaults to true (has a fleet) — only an explicit
    // false opts a partner/independent shop out of fleet reservation.
    hasFleet: b.hasFleet !== false,
  };

  const errors: string[] = [];
  if (!config.shopName) errors.push('Shop name is required.');
  if (!config.state) errors.push('State is required (for prompt-payment rules).');
  if (!config.taxId) errors.push('Tax ID / EIN is required.');
  if (!config.engagementAccepted) errors.push('Engagement agreement must be accepted.');
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(' '), errors }, { status: 400 });
  }

  const saved = saveShopConfig(config);
  return NextResponse.json({ success: true, config: saved });
}
