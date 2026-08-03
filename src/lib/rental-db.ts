/**
 * MESH — rental/loaner fleet data access.
 *
 * A session-shared fleet store (seeded from MOCK_FLEET) backs both the fleet
 * dashboard and the mobile-intake loaner selection, so assigning a loaner in
 * the field marks the same unit RENTED for the office view. DB-first with a
 * local fallback when the rental_vehicles table is unavailable.
 */
import { getSupabaseBrowserClient } from './supabase';
import { executeDBOperation } from './db-guard';
import { getCurrentProfile } from './auth';
import { MOCK_FLEET } from './rental-mock';
import { reserveVehicleForLead } from '@/app/actions/fleet-reservation';
import type { RentalStatus, RentalVehicle } from '@/components/sales/types';

const FLEET_TABLE = 'rental_vehicles';

// Session-shared store, seeded once from mock. Exposed only via the helpers.
const fleet: RentalVehicle[] = [];
let seeded = false;
function ensureSeed() {
  if (seeded) return;
  for (const v of MOCK_FLEET) fleet.push({ ...v });
  seeded = true;
}

interface FleetRow {
  id: string;
  make_model: string;
  license_plate: string;
  status: RentalStatus;
  starting_mileage: number | null;
  current_mileage: number;
  fuel_level: number;
  assigned_customer: string | null;
  assigned_ro_id: string | null;
  assigned_agent: string | null;
  expected_return_date: string | null;
}

function rowToVehicle(row: FleetRow): RentalVehicle {
  return {
    id: row.id,
    makeModel: row.make_model,
    licensePlate: row.license_plate,
    currentStatus: row.status,
    startingMileage: row.starting_mileage,
    currentMileage: row.current_mileage,
    fuelLevel: row.fuel_level,
    assignedCustomer: row.assigned_customer,
    assignedLeadId: row.assigned_ro_id,
    assignedAgent: row.assigned_agent,
    expectedReturnDate: row.expected_return_date,
  };
}

function genFleetId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `FL-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `FL-${Date.now()}`;
}

/** Loads the full fleet inventory (DB when seeded, else local/mock). */
export async function getFleet(): Promise<RentalVehicle[]> {
  const supabase = getSupabaseBrowserClient();
  const result = await executeDBOperation<FleetRow[]>(
    'getFleet',
    async () => {
      const res = await supabase.from(FLEET_TABLE).select('*').order('id');
      return { data: res.data as unknown as FleetRow[] | null, error: res.error };
    },
    [],
  );
  if (result.data && result.data.length > 0) {
    return result.data.map(rowToVehicle);
  }
  ensureSeed();
  return fleet.map((v) => ({ ...v }));
}

/** Loads only AVAILABLE fleet units. */
export async function getAvailableVehicles(): Promise<RentalVehicle[]> {
  const all = await getFleet();
  return all.filter((v) => v.currentStatus === 'AVAILABLE');
}

function patchLocal(id: string, patch: Partial<RentalVehicle>) {
  ensureSeed();
  const idx = fleet.findIndex((v) => v.id === id);
  if (idx >= 0) fleet[idx] = { ...fleet[idx], ...patch };
}

export interface AssignVehicleInput {
  leadId?: string | null;
  customerName?: string | null;
  agentName?: string | null;
  startingMileage: number;
  fuelLevel: number;
  expectedReturnDate?: string | null;
}

/** Assigns a loaner to a customer/lead/agent and marks it RENTED. */
export async function assignVehicle(vehicleId: string, input: AssignVehicleInput): Promise<void> {
  const patch: Partial<RentalVehicle> = {
    currentStatus: 'RENTED',
    startingMileage: input.startingMileage,
    currentMileage: input.startingMileage,
    fuelLevel: input.fuelLevel,
    assignedCustomer: input.customerName ?? null,
    assignedLeadId: input.leadId ?? null,
    assignedAgent: input.agentName ?? null,
    expectedReturnDate: input.expectedReturnDate ?? null,
  };
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(FLEET_TABLE)
      .update({
        status: 'RENTED',
        starting_mileage: input.startingMileage,
        current_mileage: input.startingMileage,
        fuel_level: input.fuelLevel,
        assigned_customer: input.customerName ?? null,
        assigned_ro_id: input.leadId ?? null,
        assigned_agent: input.agentName ?? null,
        expected_return_date: input.expectedReturnDate ?? null,
      })
      .eq('id', vehicleId)
      .select('id');
    if (!error && data && data.length > 0) return;
  } catch {
    /* fall through to local */
  }
  patchLocal(vehicleId, patch);
}

/**
 * Holds a vehicle for a lead without fabricating checkout data — the
 * two-phase counterpart to assignVehicle(). Routing-panel booking only knows
 * "reserve this unit for this lead," not real mileage/fuel (those are only
 * known at physical handoff, confirmed later via assignVehicle() from the
 * Fleet Command Center). Routed through a Server Action for consistency with
 * the rest of the sales-pipeline write path (see fleet-reservation.ts).
 */
export async function reserveVehicle(
  vehicleId: string,
  leadOrRoId: string,
  customerName: string,
): Promise<void> {
  const result = await reserveVehicleForLead({ vehicleId, leadOrRoId, customerName });
  if (!result.success) {
    console.warn(`[rental-db] reservation failed for vehicle ${vehicleId}:`, result.error);
    patchLocal(vehicleId, {
      currentStatus: 'RESERVED',
      assignedLeadId: leadOrRoId,
      assignedCustomer: customerName,
    });
  }
}

export interface AddVehicleInput {
  makeModel: string;
  licensePlate: string;
  currentMileage: number;
  fuelLevel: number;
}

/** Adds a new vehicle to the fleet (AVAILABLE). Returns the created vehicle. */
export async function addVehicle(input: AddVehicleInput): Promise<RentalVehicle> {
  const vehicle: RentalVehicle = {
    id: genFleetId(),
    makeModel: input.makeModel,
    licensePlate: input.licensePlate,
    currentStatus: 'AVAILABLE',
    startingMileage: null,
    currentMileage: input.currentMileage,
    fuelLevel: input.fuelLevel,
    assignedCustomer: null,
    assignedLeadId: null,
    assignedAgent: null,
    expectedReturnDate: null,
  };
  try {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from(FLEET_TABLE).insert({
      id: vehicle.id,
      make_model: vehicle.makeModel,
      license_plate: vehicle.licensePlate,
      status: 'AVAILABLE',
      current_mileage: vehicle.currentMileage,
      fuel_level: vehicle.fuelLevel,
    });
    if (!error) return vehicle;
  } catch {
    /* fall through to local */
  }
  ensureSeed();
  fleet.push({ ...vehicle });
  return vehicle;
}

/** Removes / retires a vehicle from the fleet. */
export async function removeVehicle(vehicleId: string): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(FLEET_TABLE)
      .delete()
      .eq('id', vehicleId)
      .select('id');
    if (!error && data && data.length > 0) return;
  } catch {
    /* fall through to local */
  }
  ensureSeed();
  const idx = fleet.findIndex((v) => v.id === vehicleId);
  if (idx >= 0) fleet.splice(idx, 1);
}

export interface ReturnVehicleInput {
  currentMileage?: number;
  fuelLevel?: number;
}

/** Returns a loaner to inventory (AVAILABLE) and clears its assignment. */
export async function returnVehicle(vehicleId: string, input: ReturnVehicleInput = {}): Promise<void> {
  const patch: Partial<RentalVehicle> = {
    currentStatus: 'AVAILABLE',
    assignedCustomer: null,
    assignedLeadId: null,
    assignedAgent: null,
    expectedReturnDate: null,
    startingMileage: null,
    ...(input.currentMileage != null ? { currentMileage: input.currentMileage } : {}),
    ...(input.fuelLevel != null ? { fuelLevel: input.fuelLevel } : {}),
  };
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(FLEET_TABLE)
      .update({
        status: 'AVAILABLE',
        assigned_customer: null,
        assigned_ro_id: null,
        assigned_agent: null,
        expected_return_date: null,
        starting_mileage: null,
        ...(input.currentMileage != null ? { current_mileage: input.currentMileage } : {}),
        ...(input.fuelLevel != null ? { fuel_level: input.fuelLevel } : {}),
      })
      .eq('id', vehicleId)
      .select('id');
    if (!error && data && data.length > 0) return;
  } catch {
    /* fall through to local */
  }
  patchLocal(vehicleId, patch);
}

// --- loaner driver capture ---------------------------------------------------
// One row per loan event, not columns on rental_vehicles: the same vehicle
// is loaned to different drivers over its life, and assignVehicle() above
// already overwrites assigned_customer/assigned_agent on every reassignment
// — putting license/insurance doc references directly on the vehicle row
// would lose the previous driver's documents the same way.
const LOAN_DRIVERS_TABLE = 'rental_loan_drivers';

export interface AddRentalLoanDriverInput {
  rentalVehicleId: string;
  leadId?: string | null;
  driverName: string;
  licenseDocumentUrl?: string | null;
  insuranceDocumentUrl?: string | null;
  // ATTESTED_DATA typed fields — a rep who verified the physical card/app
  // can type what it says instead of photographing it. Not mutually
  // exclusive with the document urls above; a row can carry both.
  licenseNumber?: string | null;
  licenseExpiry?: string | null; // ISO date (yyyy-mm-dd)
  insuranceCarrier?: string | null;
  policyNumber?: string | null;
  policyExpiry?: string | null; // ISO date (yyyy-mm-dd)
  // Attestation — who verified it and when, independently per item.
  driversLicenseAttestedBy?: string | null;
  driversLicenseAttestedAt?: string | null;
  driverInsuranceAttestedBy?: string | null;
  driverInsuranceAttestedAt?: string | null;
  rentalAgreementAttestedBy?: string | null;
  rentalAgreementAttestedAt?: string | null;
}

interface LocalLoanDriver extends AddRentalLoanDriverInput {}

const localLoanDrivers: LocalLoanDriver[] = [];

export interface RentalLoanDriverRecord {
  id: string;
  rentalVehicleId: string;
  leadId: string | null;
  driverName: string;
  licenseDocumentUrl: string | null;
  insuranceDocumentUrl: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  insuranceCarrier: string | null;
  policyNumber: string | null;
  policyExpiry: string | null;
  driversLicenseAttestedBy: string | null;
  driversLicenseAttestedAt: string | null;
  driverInsuranceAttestedBy: string | null;
  driverInsuranceAttestedAt: string | null;
  rentalAgreementAttestedBy: string | null;
  rentalAgreementAttestedAt: string | null;
  createdAt: string;
}

interface LoanDriverRow {
  id: string;
  rental_vehicle_id: string;
  lead_id: string | null;
  driver_name: string;
  license_document_url: string | null;
  insurance_document_url: string | null;
  license_number: string | null;
  license_expiry: string | null;
  insurance_carrier: string | null;
  policy_number: string | null;
  policy_expiry: string | null;
  drivers_license_attested_by: string | null;
  drivers_license_attested_at: string | null;
  driver_insurance_attested_by: string | null;
  driver_insurance_attested_at: string | null;
  rental_agreement_attested_by: string | null;
  rental_agreement_attested_at: string | null;
  created_at: string;
}

function rowToLoanDriver(row: LoanDriverRow): RentalLoanDriverRecord {
  return {
    id: row.id,
    rentalVehicleId: row.rental_vehicle_id,
    leadId: row.lead_id,
    driverName: row.driver_name,
    licenseDocumentUrl: row.license_document_url,
    insuranceDocumentUrl: row.insurance_document_url,
    licenseNumber: row.license_number,
    licenseExpiry: row.license_expiry,
    insuranceCarrier: row.insurance_carrier,
    policyNumber: row.policy_number,
    policyExpiry: row.policy_expiry,
    driversLicenseAttestedBy: row.drivers_license_attested_by,
    driversLicenseAttestedAt: row.drivers_license_attested_at,
    driverInsuranceAttestedBy: row.driver_insurance_attested_by,
    driverInsuranceAttestedAt: row.driver_insurance_attested_at,
    rentalAgreementAttestedBy: row.rental_agreement_attested_by,
    rentalAgreementAttestedAt: row.rental_agreement_attested_at,
    createdAt: row.created_at,
  };
}

function localToRecord(local: LocalLoanDriver): RentalLoanDriverRecord {
  return {
    id: 'local',
    rentalVehicleId: local.rentalVehicleId,
    leadId: local.leadId ?? null,
    driverName: local.driverName,
    licenseDocumentUrl: local.licenseDocumentUrl ?? null,
    insuranceDocumentUrl: local.insuranceDocumentUrl ?? null,
    licenseNumber: local.licenseNumber ?? null,
    licenseExpiry: local.licenseExpiry ?? null,
    insuranceCarrier: local.insuranceCarrier ?? null,
    policyNumber: local.policyNumber ?? null,
    policyExpiry: local.policyExpiry ?? null,
    driversLicenseAttestedBy: local.driversLicenseAttestedBy ?? null,
    driversLicenseAttestedAt: local.driversLicenseAttestedAt ?? null,
    driverInsuranceAttestedBy: local.driverInsuranceAttestedBy ?? null,
    driverInsuranceAttestedAt: local.driverInsuranceAttestedAt ?? null,
    rentalAgreementAttestedBy: local.rentalAgreementAttestedBy ?? null,
    rentalAgreementAttestedAt: local.rentalAgreementAttestedAt ?? null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Records who actually took the keys for a loaner — may differ from the AOB
 * signer (see RentalAssignmentInfo.driverName). Best-effort, DB-first with a
 * session-local mirror, matching every other write in this file.
 */
export async function addRentalLoanDriver(input: AddRentalLoanDriverInput): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from(LOAN_DRIVERS_TABLE).insert({
      rental_vehicle_id: input.rentalVehicleId,
      lead_id: input.leadId ?? null,
      driver_name: input.driverName,
      license_document_url: input.licenseDocumentUrl ?? null,
      insurance_document_url: input.insuranceDocumentUrl ?? null,
      license_number: input.licenseNumber ?? null,
      license_expiry: input.licenseExpiry ?? null,
      insurance_carrier: input.insuranceCarrier ?? null,
      policy_number: input.policyNumber ?? null,
      policy_expiry: input.policyExpiry ?? null,
      drivers_license_attested_by: input.driversLicenseAttestedBy ?? null,
      drivers_license_attested_at: input.driversLicenseAttestedAt ?? null,
      driver_insurance_attested_by: input.driverInsuranceAttestedBy ?? null,
      driver_insurance_attested_at: input.driverInsuranceAttestedAt ?? null,
      rental_agreement_attested_by: input.rentalAgreementAttestedBy ?? null,
      rental_agreement_attested_at: input.rentalAgreementAttestedAt ?? null,
    });
    if (!error) return;
  } catch {
    /* fall through to local */
  }
  localLoanDrivers.push({ ...input });
}

/**
 * Reads the most recent loan-driver record for a vehicle (optionally scoped
 * to a specific lead) — e.g. what the mobile wizard captured when a loaner
 * was first reserved with a requirement still outstanding, so the Fleet
 * Command Center's confirm-pickup screen can show what's already on file
 * instead of asking the rep to start over. Returns null when nothing has
 * been captured yet — callers must treat that as "missing everything."
 */
export async function getLatestLoanDriver(
  rentalVehicleId: string,
  leadId?: string | null,
): Promise<RentalLoanDriverRecord | null> {
  try {
    const supabase = getSupabaseBrowserClient();
    let query = supabase
      .from(LOAN_DRIVERS_TABLE)
      .select('*')
      .eq('rental_vehicle_id', rentalVehicleId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (leadId) query = query.eq('lead_id', leadId);
    const { data, error } = await query.maybeSingle();
    if (!error && data) return rowToLoanDriver(data as LoanDriverRow);
    if (!error) return null;
  } catch {
    /* fall through to local */
  }
  const candidates = localLoanDrivers.filter(
    (d) => d.rentalVehicleId === rentalVehicleId && (!leadId || d.leadId === leadId),
  );
  const last = candidates[candidates.length - 1];
  return last ? localToRecord(last) : null;
}

/**
 * Reads whether a lead's Rental / Loaner Agreement was signed on-site
 * (intake_leads.rental_agreement_signature_url) — the DOCUMENT evidence for
 * the rentalAgreement handover item when checked from the Fleet
 * confirm-pickup screen, which otherwise has no visibility into a signature
 * the mobile wizard captured against the lead, not the vehicle or the loan
 * record. Best-effort; returns null (treated as "no document") on failure.
 */
export async function getLeadRentalAgreementSignature(leadId: string | null): Promise<string | null> {
  if (!leadId) return null;
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('intake_leads')
      .select('rental_agreement_signature_url')
      .eq('id', leadId)
      .maybeSingle();
    if (!error && data) {
      return (data as { rental_agreement_signature_url: string | null }).rental_agreement_signature_url;
    }
  } catch {
    /* best-effort */
  }
  return null;
}

// --- per-shop handover requirements -------------------------------------------
export type HandoverLevel = 'NONE' | 'ATTESTED_DATA' | 'DOCUMENT';

export interface RentalHandoverRequirements {
  driversLicense: HandoverLevel;
  driverInsurance: HandoverLevel;
  rentalAgreement: HandoverLevel;
}

// Matches the migration's own column default. DOCUMENT is the strictest
// level, so it's the fail-closed default for all three whenever the org,
// the column, or the session can't be resolved — a network failure must
// never silently loosen the gate.
const DEFAULT_HANDOVER_REQUIREMENTS: RentalHandoverRequirements = {
  driversLicense: 'DOCUMENT',
  driverInsurance: 'DOCUMENT',
  rentalAgreement: 'DOCUMENT',
};

const VALID_HANDOVER_LEVELS: readonly string[] = ['NONE', 'ATTESTED_DATA', 'DOCUMENT'];
function coerceHandoverLevel(v: unknown): HandoverLevel {
  return typeof v === 'string' && VALID_HANDOVER_LEVELS.includes(v) ? (v as HandoverLevel) : 'DOCUMENT';
}

/**
 * Reads the current session's org's driver-document handover policy — the
 * NONE / ATTESTED_DATA / DOCUMENT level required per item before a loaner's
 * keys can be released. Falls back to DOCUMENT/DOCUMENT/DOCUMENT (the safe
 * default) whenever the org, the column, an unrecognized value, or the
 * session can't be resolved, rather than defaulting open.
 */
export async function getRentalHandoverRequirements(): Promise<RentalHandoverRequirements> {
  try {
    const supabase = getSupabaseBrowserClient();
    const profile = await getCurrentProfile(supabase);
    if (!profile?.organizationId) return DEFAULT_HANDOVER_REQUIREMENTS;
    const { data, error } = await supabase
      .from('organizations')
      .select('rental_handover_requirements')
      .eq('id', profile.organizationId)
      .maybeSingle();
    if (!error && data) {
      const raw = (data as { rental_handover_requirements: unknown }).rental_handover_requirements;
      if (raw && typeof raw === 'object') {
        const r = raw as Partial<Record<keyof RentalHandoverRequirements, unknown>>;
        return {
          driversLicense: coerceHandoverLevel(r.driversLicense),
          driverInsurance: coerceHandoverLevel(r.driverInsurance),
          rentalAgreement: coerceHandoverLevel(r.rentalAgreement),
        };
      }
    }
  } catch {
    /* fall through to the safe default */
  }
  return DEFAULT_HANDOVER_REQUIREMENTS;
}

/**
 * True when a handover item's requirement level is satisfied. Shared by the
 * mobile wizard and the Fleet confirm-pickup screen so the three-level
 * logic isn't duplicated per item per caller.
 */
export function isHandoverItemSatisfied(
  level: HandoverLevel,
  opts: { hasTypedData: boolean; attested: boolean; hasDocument: boolean },
): boolean {
  if (level === 'NONE') return true;
  if (level === 'ATTESTED_DATA') return opts.hasTypedData && opts.attested;
  return opts.hasDocument; // DOCUMENT
}

/** Sets a vehicle's status directly (e.g. toggle MAINTENANCE). */
export async function setVehicleStatus(vehicleId: string, status: RentalStatus): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(FLEET_TABLE)
      .update({ status })
      .eq('id', vehicleId)
      .select('id');
    if (!error && data && data.length > 0) return;
  } catch {
    /* fall through to local */
  }
  patchLocal(vehicleId, { currentStatus: status });
}
