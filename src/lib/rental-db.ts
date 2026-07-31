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
