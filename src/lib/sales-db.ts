/**
 * MESH Sales & Intake — data access layer.
 *
 * Lead pipeline reads/writes with a session-local fallback (seeded from mock)
 * when the intake_leads table is unavailable, plus convertLeadToRO which drops
 * an approved lead onto the Ops production floor as a new INTAKE repair order.
 */
import { getSupabaseBrowserClient } from './supabase';
import { executeDBOperation } from './db-guard';
import { assignStaff } from './assignments-db';
import { getCurrentProfile } from './auth';
import { MOCK_LEADS } from './sales-mock';
import { MOCK_BOARD_ORDERS } from './ops-mock';
import { bridgeRepairOrder } from '@/app/actions/intake-bridge';
import { dispatchMobileUnit, advanceDispatchStatus } from '@/app/actions/dispatch';
import { getCarrierIntel, CHECKLIST_ITEM_LABEL } from '@/lib/carrier-intel';
import type {
  DamageType,
  DispatchStatus,
  IntakeDocumentRef,
  IntakeLead,
  IntakeSubmission,
  LeadChannel,
  LeadStatus,
  LeadVehicle,
  ProxyPolicyholder,
  RemoteAobStatus,
  RoutingPath,
  StormSeverity,
} from '@/components/sales/types';

const LEADS_TABLE = 'intake_leads';
const LEAD_VEHICLES_TABLE = 'lead_vehicles';

/** Raw intake_leads row (snake_case). */
export interface LeadRow {
  id: string;
  customer_name: string;
  phone?: string | null;
  email?: string | null;
  vehicle_year?: number | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_info?: string | null;
  vin_last8?: string | null;
  insurance_carrier?: string | null;
  claim_number?: string | null;
  estimated_amount?: number | null;
  documents: Record<string, unknown>;
  walkaround_notes: Record<string, unknown>;
  signature_url?: string | null;
  status: LeadStatus;
  agreement_accepted?: boolean | null;
  assigned_staff_id?: string | null;
  assigned_staff_name?: string | null;
  created_at: string;
  channel?: LeadChannel | null;
  storm_tag?: string | null;
  zip_code?: string | null;
  severity?: StormSeverity | null;
  damage_photos?: IntakeDocumentRef[] | null;
  routing_path?: RoutingPath | null;
  dispatch_staff_name?: string | null;
  dispatch_status?: DispatchStatus | null;
  policyholder_match?: boolean | null;
  proxy_policyholder?: ProxyPolicyholder | null;
  remote_aob_status?: RemoteAobStatus | null;
  remote_aob_token?: string | null;
  address?: string | null;
  damage_type?: DamageType | null;
}

function rowToLead(row: LeadRow): IntakeLead {
  return {
    id: row.id,
    customerName: row.customer_name,
    phone: row.phone ?? '',
    email: row.email ?? '',
    vehicleYear: row.vehicle_year ?? 0,
    vehicleMake: row.vehicle_make ?? '',
    vehicleModel: row.vehicle_model ?? '',
    vinLast8: row.vin_last8 ?? '',
    insuranceCarrier: row.insurance_carrier ?? '',
    claimNumber: row.claim_number ?? '',
    status: row.status,
    intakeDate: row.created_at,
    estimatedAmount: row.estimated_amount ?? 0,
    agreementAccepted: row.agreement_accepted ?? undefined,
    assignedStaffId: row.assigned_staff_id ?? undefined,
    assignedStaffName: row.assigned_staff_name ?? undefined,
    // Pre-hub leads predate the channel column — default to the Digital
    // Inbound tab (web/social source) rather than orphaning them.
    channel: row.channel ?? 'DIGITAL_INBOUND',
    stormTag: row.storm_tag ?? undefined,
    zipCode: row.zip_code ?? undefined,
    severity: row.severity ?? undefined,
    damagePhotos: row.damage_photos ?? undefined,
    routingPath: row.routing_path ?? undefined,
    dispatchStaffName: row.dispatch_staff_name ?? undefined,
    dispatchStatus: row.dispatch_status ?? undefined,
    policyholderMatch: row.policyholder_match ?? undefined,
    proxyPolicyholder: row.proxy_policyholder ?? undefined,
    remoteAobStatus: row.remote_aob_status ?? undefined,
    remoteAobToken: row.remote_aob_token ?? undefined,
    address: row.address ?? undefined,
    damageType: row.damage_type ?? undefined,
  };
}

/**
 * Thrown by convertLeadToRO's carrier-checklist gate. Deliberately a
 * distinct type so the DB-flow's broad catch (infrastructure failures →
 * fall back to the local bridge) can single it out and rethrow instead of
 * silently degrading a business-rule stop into a silently-provisioned RO.
 */
class CarrierChecklistIncompleteError extends Error {}

function genId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

/**
 * A bare, RFC4122 v4-shaped id — unlike genId()'s prefixed ids, this is a
 * valid Postgres `uuid` literal. Use for any id that gets inserted as the
 * `id` of a table with a native `uuid` primary key (e.g. repair_orders),
 * where a prefixed id like 'ro-<uuid>' fails with 22P02 ("invalid input
 * syntax for type uuid").
 */
function genUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Session-local lead store — the fallback when the DB table is unavailable —
// seeded once from the mock data.
const localLeads: IntakeLead[] = [];
let seeded = false;
function ensureSeed() {
  if (seeded) return;
  for (const lead of MOCK_LEADS) localLeads.push({ ...lead });
  seeded = true;
}

/** Loads all intake leads (DB when seeded, else local/mock). */
export async function getLeads(): Promise<IntakeLead[]> {
  const supabase = getSupabaseBrowserClient();
  const result = await executeDBOperation<LeadRow[]>(
    'getLeads',
    async () => {
      const res = await supabase
        .from(LEADS_TABLE)
        .select('*')
        .order('created_at', { ascending: false });
      return { data: res.data as unknown as LeadRow[] | null, error: res.error };
    },
    [],
  );
  if (result.data && result.data.length > 0) {
    const leads = result.data.map(rowToLead);
    return attachAdditionalVehicles(leads);
  }
  ensureSeed();
  return attachAdditionalVehicles(localLeads.map((l) => ({ ...l })));
}

// ---------------------------------------------------------------------------
// Multi-Vehicle Household Leads — vehicles beyond a lead's primary one.
// ---------------------------------------------------------------------------

interface LeadVehicleRow {
  id: string;
  lead_id: string;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vin: string | null;
  severity: StormSeverity | null;
}

function rowToLeadVehicle(row: LeadVehicleRow): LeadVehicle {
  return {
    id: row.id,
    vehicleYear: row.vehicle_year ?? undefined,
    vehicleMake: row.vehicle_make ?? undefined,
    vehicleModel: row.vehicle_model ?? undefined,
    vin: row.vin ?? undefined,
    severity: row.severity ?? undefined,
  };
}

// Session-local fallback for additional vehicles, keyed by leadId — mirrors
// every other DAL write here when the table is unavailable/unmigrated yet.
const localLeadVehicles = new Map<string, LeadVehicle[]>();

/**
 * Attaches additionalVehicles to each lead via a single bulk query (not one
 * query per lead) — most leads are single-vehicle, so this only matters for
 * households a storm hit multiple vehicles at. Best-effort: a missing/
 * unmigrated table just leaves leads without the field, same as any other
 * DB-first-with-fallback read here.
 */
async function attachAdditionalVehicles(leads: IntakeLead[]): Promise<IntakeLead[]> {
  if (leads.length === 0) return leads;
  const byLeadId = new Map<string, LeadVehicle[]>();

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(LEAD_VEHICLES_TABLE)
      .select('*')
      .in(
        'lead_id',
        leads.map((l) => l.id),
      )
      .order('created_at', { ascending: true });
    if (!error && data) {
      for (const row of data as LeadVehicleRow[]) {
        const list = byLeadId.get(row.lead_id) ?? [];
        list.push(rowToLeadVehicle(row));
        byLeadId.set(row.lead_id, list);
      }
    }
  } catch {
    /* fall through — local fallback below still applies per-lead */
  }

  return leads.map((lead) => {
    const vehicles = byLeadId.get(lead.id) ?? localLeadVehicles.get(lead.id);
    return vehicles && vehicles.length > 0 ? { ...lead, additionalVehicles: vehicles } : lead;
  });
}

export interface AddLeadVehicleInput {
  vehicleYear?: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vin?: string;
  severity?: StormSeverity;
}

/**
 * Adds a vehicle beyond a lead's primary one — a storm can hit more than one
 * vehicle at the same property. DB-first with a local-fallback mirror.
 */
export async function addLeadVehicle(
  leadId: string,
  input: AddLeadVehicleInput,
): Promise<LeadVehicle> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(LEAD_VEHICLES_TABLE)
      .insert({
        lead_id: leadId,
        vehicle_year: input.vehicleYear ?? null,
        vehicle_make: input.vehicleMake ?? null,
        vehicle_model: input.vehicleModel ?? null,
        vin: input.vin ?? null,
        severity: input.severity ?? null,
      })
      .select('id')
      .single();
    if (!error && data) {
      return { id: String((data as { id: string }).id), ...input };
    }
  } catch {
    /* fall through to local */
  }

  const vehicle: LeadVehicle = { id: genUuid(), ...input };
  const existing = localLeadVehicles.get(leadId) ?? [];
  localLeadVehicles.set(leadId, [...existing, vehicle]);
  return vehicle;
}

// Session-local store of full intake packages (document refs + signature +
// walkaround), keyed by the created lead id.
const intakePackages: Record<string, IntakeSubmission> = {};

// Tracks which leads already have a bridged RO, so intake auto-creation and a
// later manual convert don't create duplicate ROs.
const leadRoMap = new Map<string, string>();

/**
 * Converted leads available to pull into a manual Ops intake, each enriched
 * with a computed damage-notes summary (condition notes + flagged walkaround
 * items) from its original mobile-intake submission, mirroring the note
 * logic bridgeIntakeToOps already uses when auto-creating an RO.
 */
export async function getConvertedLeadsForPull(): Promise<(IntakeLead & { damageNotes: string })[]> {
  const leads = await getLeads();
  return leads
    .filter((l) => l.status === 'CONVERTED')
    .map((l) => {
      const submission = intakePackages[l.id];
      const walkFlags = (submission?.walkaround ?? [])
        .filter((w) => w.flagged)
        .map((w) => w.label);
      const noteParts: string[] = [];
      if (submission?.conditionNotes) noteParts.push(submission.conditionNotes);
      if (walkFlags.length) noteParts.push(`Pre-existing: ${walkFlags.join(', ')}`);
      return { ...l, damageNotes: noteParts.join(' · ') };
    });
}

/**
 * Bridges an intake lead into an active Repair Order on the shop Ops board.
 * Resolves the lead + stored intake submission by id from the local stores,
 * maps customer / vehicle / VIN / claim / carrier and the walkaround, hail
 * matrix, and document refs so shop managers see the field context. Idempotent
 * per lead; returns the RO id.
 */
async function bridgeIntakeToOps(leadId: string): Promise<string> {
  const existing = leadRoMap.get(leadId);
  if (existing) return existing;

  ensureSeed();
  const lead = localLeads.find((l) => l.id === leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  const submission = intakePackages[leadId];

  const roId = genUuid();
  leadRoMap.set(leadId, roId);
  const now = new Date().toISOString();

  // organization_id is NOT NULL on repair_orders. Resolving it is a hard
  // requirement, not best-effort: we cannot guess which tenant this write
  // belongs to, so resolveOrganizationId() is deliberately left outside the
  // try/catch below and allowed to throw straight out of this function.
  const organizationId = await resolveOrganizationId();

  // Best-effort DB insert, routed through a Server Action: the browser's
  // anon-key client 403s on repair_orders (RLS), so the actual privileged
  // insert runs server-side with the service-role client instead. Only this
  // part — network/RLS/timeout failures on the insert itself — stays
  // best-effort, so a field rep never loses a lead on a bad connection.
  try {
    const result = await bridgeRepairOrder({
      id: roId,
      customerName: lead.customerName,
      claimNumber: lead.claimNumber || null,
      organizationId: organizationId || null,
    });
    if (!result.success) {
      console.warn(`[sales-db] repair_orders insert failed for RO ${roId}:`, result.error);
    }
  } catch (err) {
    /* ignore — the local board bridge below is the dev source of truth */
    console.warn(`[sales-db] repair_orders server action failed for RO ${roId}:`, err);
  }

  const activeHail = (submission?.hailMatrix ?? []).filter((h) => h.severity !== 'NONE');
  const walkFlags = (submission?.walkaround ?? [])
    .filter((w) => w.flagged)
    .map((w) => w.label);
  const noteParts: string[] = [];
  if (submission?.conditionNotes) noteParts.push(submission.conditionNotes);
  if (walkFlags.length) noteParts.push(`Pre-existing: ${walkFlags.join(', ')}`);

  MOCK_BOARD_ORDERS.push({
    id: roId,
    claim_number: lead.claimNumber || null,
    customer_name: lead.customerName,
    vehicle: `${lead.vehicleYear} ${lead.vehicleMake} ${lead.vehicleModel}`.trim(),
    vin: lead.vinLast8 || null,
    location: 'Intake',
    stage: 'INTAKE',
    hold_gate_active: false,
    risk_score: null,
    created_at: now,
    updated_at: now,
    insuranceCarrier: lead.insuranceCarrier || null,
    assignedStaffName: lead.assignedStaffName || null,
    intakeNotes: noteParts.join(' · ') || null,
    intakeHail: activeHail.map((h) => ({ panel: h.panel, severity: h.severity })),
    intakeDocuments: (submission?.documents ?? []).map((d) => ({
      kind: d.kind,
      fileName: d.fileName,
      url: d.url ?? null,
    })),
  });
  return roId;
}

/**
 * Auto-convert business rule, shared by every path that can put a lead into
 * AOB_SIGNED: a claim number on file means the engagement agreement being
 * signed — on-site or via a remote proxy signing link — immediately converts
 * the lead into an active Repair Order. Best-effort: a conversion failure
 * never rolls back or blocks the status/creation that triggered it.
 */
async function maybeAutoConvertOnAobSigned(leadId: string, status: LeadStatus, claimNumber: string | undefined): Promise<void> {
  if (status !== 'AOB_SIGNED' || !claimNumber) return;
  try {
    await convertLeadToRO(leadId);
  } catch (err) {
    console.warn(`[sales-db] auto-conversion on AOB_SIGNED failed for lead ${leadId}:`, err);
  }
}

/**
 * Persists a mobile intake package as an active lead record: creates the
 * lead, stores its document references / signature / walkaround in the
 * session-local package store, and returns the created lead. Attempts a DB
 * insert first; falls back to local storage when the table is unavailable.
 *
 * In-Person AOB Execution Gate: a captured on-site signature creates the lead
 * directly at AOB_SIGNED (immediately triggering the auto-convert-to-RO
 * rule) rather than NEW + a flag needing a later manual status change. A
 * lead routed to a remote proxy policyholder instead (no on-site signature)
 * is created at NEW, pending the Remote AOB Execution Gate.
 */
export async function saveIntakePackage(submission: IntakeSubmission): Promise<IntakeLead> {
  ensureSeed();
  // Resolves the caller's org or throws — a lead can never be written
  // (DB or local fallback) without one. Runs before any write, local
  // included, so a failure here blocks the whole function, not just the DB
  // insert's best-effort path below.
  const organizationId = await resolveOrganizationId();
  const id = genId('lead');
  const status: LeadStatus = submission.signatureDataUrl ? 'AOB_SIGNED' : 'NEW';
  const policyholderMatch = submission.policyholderMatch ?? true;
  const lead: IntakeLead = {
    id,
    customerName: submission.customerName,
    phone: submission.phone,
    email: submission.email,
    vehicleYear: submission.vehicleYear,
    vehicleMake: submission.vehicleMake,
    vehicleModel: submission.vehicleModel,
    vinLast8: submission.vinLast8,
    insuranceCarrier: submission.insuranceCarrier,
    claimNumber: submission.claimNumber,
    status,
    intakeDate: new Date().toISOString(),
    estimatedAmount: submission.estimatedAmount,
    agreementAccepted: Boolean(submission.signatureDataUrl),
    assignedStaffId: submission.assignedStaffId,
    assignedStaffName: submission.assignedStaffName,
    // The mobile wizard IS the field agent's on-site capture tool — leads
    // created through it belong on the Field Agent Dispatch tab.
    channel: 'FIELD_DISPATCH',
    policyholderMatch,
    proxyPolicyholder: policyholderMatch ? undefined : submission.proxyPolicyholder ?? undefined,
    remoteAobStatus: policyholderMatch ? undefined : 'NOT_SENT',
  };

  try {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from(LEADS_TABLE).insert({
      id: lead.id,
      organization_id: organizationId,
      customer_name: lead.customerName,
      phone: lead.phone,
      email: lead.email,
      vehicle_year: lead.vehicleYear,
      vehicle_make: lead.vehicleMake,
      vehicle_model: lead.vehicleModel,
      vehicle_info: `${lead.vehicleYear} ${lead.vehicleMake} ${lead.vehicleModel}`.trim(),
      vin_last8: lead.vinLast8,
      insurance_carrier: lead.insuranceCarrier,
      claim_number: lead.claimNumber,
      estimated_amount: lead.estimatedAmount,
      documents: submission.documents,
      walkaround_notes: submission.walkaround,
      signature_url: submission.signatureDataUrl || null,
      status: lead.status,
      created_at: lead.intakeDate,
      agreement_accepted: lead.agreementAccepted ?? false,
      assigned_staff_id: lead.assignedStaffId ?? null,
      assigned_staff_name: lead.assignedStaffName ?? null,
      channel: lead.channel,
      policyholder_match: policyholderMatch,
      proxy_policyholder: lead.proxyPolicyholder ?? null,
      remote_aob_status: lead.remoteAobStatus ?? null,
    });
    if (error) {
      /* fall through to local store */
    }
  } catch {
    /* fall through to local store */
  }

  localLeads.unshift({ ...lead });
  intakePackages[id] = submission;
  // Completing a mobile intake creates a corresponding active RO on the shop
  // floor, carrying the field walkaround / hail / document context. This can
  // still throw (e.g. an unresolvable tenant) — the lead itself is already
  // persisted above by this point, but the caller needs a clear, rep-facing
  // reason rather than a raw internal error string.
  try {
    await bridgeIntakeToOps(id);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not open the repair order for this intake (${detail}). The lead was saved — retry to finish the handoff.`,
    );
  }
  await maybeAutoConvertOnAobSigned(id, status, lead.claimNumber);
  return lead;
}

export interface DigitalLeadInput {
  customerName: string;
  phone: string;
  email: string;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  insuranceCarrier: string;
  claimNumber: string;
  estimatedAmount: number;
  stormTag: string;
  zipCode: string;
  severity: StormSeverity;
  /** Full captured document vault (DL front/back, insurance card, prior
   *  estimate, dynamic carrier checklist, damage photos) — persisted as-is
   *  to the intake_leads.documents column. */
  documents: IntakeDocumentRef[];
  policyholderMatch: boolean;
  proxyPolicyholder?: ProxyPolicyholder | null;
}

/**
 * Creates a Digital Inbound & Storm Triage lead — the lightweight web/social
 * intake path, distinct from the full mobile-intake wizard (no signature/AOB
 * agreement at this stage; that happens later in the pipeline). Attempts a DB
 * insert first; always mirrors to the local store as the fallback.
 */
export async function createDigitalLead(input: DigitalLeadInput): Promise<IntakeLead> {
  ensureSeed();
  // See saveIntakePackage — resolves or throws before any write happens.
  const organizationId = await resolveOrganizationId();
  const id = genId('lead');
  const lead: IntakeLead = {
    id,
    customerName: input.customerName,
    phone: input.phone,
    email: input.email,
    vehicleYear: input.vehicleYear,
    vehicleMake: input.vehicleMake,
    vehicleModel: input.vehicleModel,
    vinLast8: '',
    insuranceCarrier: input.insuranceCarrier,
    claimNumber: input.claimNumber,
    status: 'NEW',
    intakeDate: new Date().toISOString(),
    estimatedAmount: input.estimatedAmount,
    channel: 'DIGITAL_INBOUND',
    stormTag: input.stormTag || undefined,
    zipCode: input.zipCode || undefined,
    severity: input.severity,
    damagePhotos: input.documents.filter((d) => d.kind === 'DAMAGE_PHOTO'),
    policyholderMatch: input.policyholderMatch,
    proxyPolicyholder: input.policyholderMatch ? undefined : input.proxyPolicyholder ?? undefined,
    remoteAobStatus: input.policyholderMatch ? undefined : 'NOT_SENT',
  };

  try {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from(LEADS_TABLE).insert({
      id: lead.id,
      organization_id: organizationId,
      customer_name: lead.customerName,
      phone: lead.phone,
      email: lead.email,
      vehicle_year: lead.vehicleYear,
      vehicle_make: lead.vehicleMake,
      vehicle_model: lead.vehicleModel,
      vehicle_info: `${lead.vehicleYear} ${lead.vehicleMake} ${lead.vehicleModel}`.trim(),
      insurance_carrier: lead.insuranceCarrier,
      claim_number: lead.claimNumber,
      estimated_amount: lead.estimatedAmount,
      documents: input.documents,
      walkaround_notes: [],
      status: lead.status,
      created_at: lead.intakeDate,
      channel: lead.channel,
      storm_tag: lead.stormTag ?? null,
      zip_code: lead.zipCode ?? null,
      severity: lead.severity ?? null,
      damage_photos: lead.damagePhotos ?? [],
      policyholder_match: lead.policyholderMatch,
      proxy_policyholder: lead.proxyPolicyholder ?? null,
      remote_aob_status: lead.remoteAobStatus ?? null,
    });
    if (error) {
      /* fall through to local store */
    }
  } catch {
    /* fall through to local store */
  }

  localLeads.unshift({ ...lead });
  return lead;
}

export interface QuickLeadInput {
  customerName: string;
  phone?: string;
  address?: string;
  vehicleMake?: string;
  damageType?: DamageType;
}

/**
 * Quick Porch Capture — the fastest possible lead entry: a rep standing at a
 * customer's door needs to grab a name (the only required field) before
 * anything else, filling in the rest via the full intake later. Attempts a
 * DB insert first; always mirrors to the local store as the fallback.
 */
export async function createQuickLead(input: QuickLeadInput): Promise<IntakeLead> {
  ensureSeed();
  // See saveIntakePackage — resolves or throws before any write happens.
  const organizationId = await resolveOrganizationId();
  const id = genId('lead');
  const vehicleMake = input.vehicleMake?.trim() ?? '';
  const lead: IntakeLead = {
    id,
    customerName: input.customerName.trim(),
    phone: input.phone?.trim() ?? '',
    email: '',
    vehicleYear: 0,
    vehicleMake,
    vehicleModel: '',
    vinLast8: '',
    insuranceCarrier: '',
    claimNumber: '',
    status: 'NEW',
    intakeDate: new Date().toISOString(),
    estimatedAmount: 0,
    // A rep on-site at the customer's property is the same field-capture
    // context the mobile intake wizard uses.
    channel: 'FIELD_DISPATCH',
    address: input.address?.trim() || undefined,
    damageType: input.damageType,
  };

  try {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from(LEADS_TABLE).insert({
      id: lead.id,
      organization_id: organizationId,
      customer_name: lead.customerName,
      phone: lead.phone || null,
      vehicle_make: vehicleMake || null,
      vehicle_info: vehicleMake ? `${vehicleMake} (Pending Details)` : null,
      status: lead.status,
      created_at: lead.intakeDate,
      agreement_accepted: false,
      documents: [],
      walkaround_notes: [],
      channel: lead.channel,
      address: lead.address ?? null,
      damage_type: lead.damageType ?? null,
    });
    if (error) {
      /* fall through to local store */
    }
  } catch {
    /* fall through to local store */
  }

  localLeads.unshift({ ...lead });
  return lead;
}

/**
 * Updates a lead's pipeline status (DB when available, else local).
 *
 * Automated state machine: a transition INTO 'AOB_SIGNED' (the engagement
 * agreement is signed — the definitive "signed sales estimate" moment) with a
 * claim number on file automatically converts the lead into an active Repair
 * Order, mapping customer + insurance metadata into the Ops intake pipeline
 * via convertLeadToRO. Best-effort: a conversion failure never rolls back or
 * blocks the status change itself.
 */
export async function updateLeadStatus(id: string, status: LeadStatus): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(LEADS_TABLE)
      .update({ status })
      .eq('id', id)
      .select('id');
    if (error || !data || data.length === 0) throw error ?? new Error('no rows updated');
  } catch {
    /* fall through to local */
  }
  ensureSeed();
  // Keep the local mirror in sync regardless of which path persisted the
  // status, so downstream reads (including the lifecycle hook below) see the
  // current value rather than a stale cached copy.
  const lead = localLeads.find((l) => l.id === id);
  if (lead) lead.status = status;

  await maybeAutoConvertOnAobSigned(id, status, lead?.claimNumber);
}

/**
 * Assigns (or reassigns) the accountable sales rep on a lead. Persists to the
 * DB when the table is available, else updates the session-local store so the
 * board reflects ownership immediately. A null staffName clears the owner.
 */
export async function assignLeadStaff(
  id: string,
  staffName: string | null,
  staffId?: string | null,
): Promise<void> {
  const name = staffName?.trim() || null;
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(LEADS_TABLE)
      .update({ assigned_staff_name: name, assigned_staff_id: staffId ?? null })
      .eq('id', id)
      .select('id');
    if (!error && data && data.length > 0) return;
  } catch {
    /* fall through to local */
  }
  ensureSeed();
  const lead = localLeads.find((l) => l.id === id);
  if (lead) {
    lead.assignedStaffName = name ?? undefined;
    lead.assignedStaffId = staffId ?? undefined;
  }
}

/**
 * Records the post-contact routing decision on a lead card: Book Shop
 * Drop-off + Fleet Reservation. (Dispatch Mobile House Call moved to Ops —
 * see dispatchLead() below, backed by the dispatch.ts Server Action — so
 * this is only ever called with 'SHOP_DROPOFF' now; the MOBILE_HOUSE_CALL
 * branch stays correct if that ever changes, just currently unreachable.)
 */
export async function updateLeadRouting(
  id: string,
  routingPath: RoutingPath,
  dispatchStaffName?: string | null,
): Promise<void> {
  const dispatchStatus: DispatchStatus | null =
    routingPath === 'MOBILE_HOUSE_CALL' ? 'DISPATCHED' : null;
  const staffName = routingPath === 'MOBILE_HOUSE_CALL' ? dispatchStaffName?.trim() || null : null;

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(LEADS_TABLE)
      .update({
        routing_path: routingPath,
        dispatch_staff_name: staffName,
        dispatch_status: dispatchStatus,
      })
      .eq('id', id)
      .select('id');
    if (!error && data && data.length > 0) {
      /* also fall through — keep the local mirror in sync below */
    }
  } catch {
    /* fall through to local */
  }
  ensureSeed();
  const lead = localLeads.find((l) => l.id === id);
  if (lead) {
    lead.routingPath = routingPath;
    lead.dispatchStaffName = staffName ?? undefined;
    lead.dispatchStatus = dispatchStatus ?? undefined;
  }
}

/**
 * Routes a lead to a mobile house call and starts its dispatch lifecycle —
 * the Ops-side counterpart to updateLeadRouting's shop-drop-off path. Routed
 * through the dispatch.ts Server Action (Ops Workflow Realignment: field
 * deployment is now an Ops/Shop Manager decision, not a Sales-rep one).
 */
export async function dispatchLead(id: string, agentName: string): Promise<void> {
  const staffName = agentName.trim();
  const result = await dispatchMobileUnit({ leadId: id, agentName: staffName });
  if (!result.success) {
    console.warn(`[sales-db] dispatch failed for lead ${id}:`, result.error);
    ensureSeed();
    const lead = localLeads.find((l) => l.id === id);
    if (lead) {
      lead.routingPath = 'MOBILE_HOUSE_CALL';
      lead.dispatchStaffName = staffName;
      lead.dispatchStatus = 'DISPATCHED';
    }
  }
}

/** Advances a mobile house-call lead's field dispatch lifecycle. */
export async function updateDispatchStatus(id: string, status: DispatchStatus): Promise<void> {
  const result = await advanceDispatchStatus({ leadId: id, status });
  if (!result.success) {
    console.warn(`[sales-db] dispatch status update failed for lead ${id}:`, result.error);
    ensureSeed();
    const lead = localLeads.find((l) => l.id === id);
    if (lead) lead.dispatchStatus = status;
  }
}

/**
 * Records that a Remote AOB Secure Signing Link was created and dispatched
 * for a lead (called by the remote-aob API route after the email/SMS send).
 */
export async function markRemoteAobDispatched(leadId: string, token: string): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    await supabase
      .from(LEADS_TABLE)
      .update({ remote_aob_status: 'SENT', remote_aob_token: token })
      .eq('id', leadId);
  } catch {
    /* fall through to local */
  }
  ensureSeed();
  const lead = localLeads.find((l) => l.id === leadId);
  if (lead) {
    lead.remoteAobStatus = 'SENT';
    lead.remoteAobToken = token;
  }
}

/**
 * Resolves the signed-in user's organization id to write RO/vehicle rows
 * against. Throws rather than falling back to an arbitrary organization —
 * a silent fallback here previously let repair orders and vehicles get
 * written into an organization the caller didn't belong to (cross-tenant
 * write, confirmed in live data). Callers must handle the throw; do not
 * reintroduce a fallback that swallows it.
 */
async function resolveOrganizationId(): Promise<string> {
  const profile = await getCurrentProfile(getSupabaseBrowserClient());
  if (profile?.organizationId) return profile.organizationId;
  throw new Error('Cannot resolve organization for the current session');
}

/**
 * Converts an approved lead into an active Production RO and returns the new RO
 * id. When an organizationId is available it runs the real multi-step DB flow
 * (provision vehicle → insert repair_order → archive the lead as CONVERTED);
 * on any DB error, a missing org, or an unmigrated table it falls back to the
 * shared local Ops-board bridge so the RO is still visible on the floor.
 * Idempotent per lead.
 */
export async function convertLeadToRO(
  leadId: string,
  organizationId?: string,
): Promise<string> {
  ensureSeed();
  const cached = leadRoMap.get(leadId);
  if (cached) return cached;

  // If no org id was passed, resolve from the current session, falling back
  // to the first DB org (dev fallback) — see resolveOrganizationId().
  const activeOrgId = organizationId || (await resolveOrganizationId());

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // Prefix normalization: locally-generated lead ids carry a 'lead-' prefix
  // (genId('lead')) that isn't part of the underlying UUID once one exists —
  // strip it before matching/querying so a DB-backed lead can still be found
  // even when the caller's reference carries the local-only prefix.
  const normalizedLeadId = leadId.startsWith('lead-') ? leadId.slice('lead-'.length) : leadId;

  // 3. If an organization was secured and the normalized ID is a valid
  // database UUID, attempt the true multi-step DB flow.
  if (activeOrgId && UUID_REGEX.test(normalizedLeadId)) {
    try {
      const supabase = getSupabaseBrowserClient();

      const { data, error: leadError } = await supabase
        .from(LEADS_TABLE)
        .select('*')
        .eq('id', normalizedLeadId)
        .maybeSingle();
      if (leadError) throw new Error(`Failed to fetch lead: ${leadError.message}`);

      let lead = data as unknown as LeadRow | null;

      // Graceful local fallback: zero rows (e.g. an unpersisted mock/seed
      // lead) is not a hard failure — intercept the miss, pull the payload
      // from the active local cache, and continue provisioning the RO from
      // it instead of throwing.
      //
      // NOTE: documents is set to {} below — localLeads/IntakeLead doesn't
      // retain the original IntakeDocumentRef[] captured at intake. Any lead
      // reconstructed through this branch will therefore always show every
      // carrier-checklist item as missing under the gate a few lines down,
      // regardless of what was actually captured. Known gap, not fixed here.
      if (!lead) {
        ensureSeed();
        const cached = localLeads.find((l) => l.id === leadId);
        if (!cached) throw new Error(`Lead ${leadId} not found in DB or local cache.`);
        lead = {
          id: cached.id,
          customer_name: cached.customerName,
          vehicle_info: `${cached.vehicleYear} ${cached.vehicleMake} ${cached.vehicleModel}`.trim(),
          vin_last8: cached.vinLast8 || null,
          claim_number: cached.claimNumber || null,
          documents: {},
          walkaround_notes: {},
          status: cached.status,
          assigned_staff_id: cached.assignedStaffId ?? null,
          assigned_staff_name: cached.assignedStaffName ?? null,
          created_at: cached.intakeDate,
        };
      }

      // Carrier-checklist gate — moved here from MobileIntakeWizard's step-2
      // canProceed(), which used to block the LEAD from being saved at all.
      // Now the lead always saves; this blocks only RO provisioning, naming
      // exactly what's missing so an office coordinator knows what to chase.
      const requiredChecklist = getCarrierIntel(lead.insurance_carrier ?? '').requiredChecklist;
      if (requiredChecklist.length > 0) {
        const capturedKinds = new Set(
          Array.isArray(lead.documents)
            ? (lead.documents as IntakeDocumentRef[])
                .filter((d) => d && typeof d === 'object' && 'kind' in d)
                .map((d) => d.kind)
            : [],
        );
        const missing = requiredChecklist.filter((kind) => !capturedKinds.has(kind));
        if (missing.length > 0) {
          throw new CarrierChecklistIncompleteError(
            `Cannot open repair order — missing carrier-required documentation: ${missing
              .map((kind) => CHECKLIST_ITEM_LABEL[kind])
              .join(', ')}.`,
          );
        }
      }

      // Provision vehicle record.
      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert({
          organization_id: activeOrgId,
          vin: lead.vin_last8,
          model: lead.vehicle_info,
        })
        .select('id')
        .single();
      if (vehicleError || !vehicle) {
        throw new Error(`Vehicle provisioning failed: ${vehicleError?.message}`);
      }

      // Insert the active repair order (no `vin` column on repair_orders).
      const { data: ro, error: roError } = await supabase
        .from('repair_orders')
        .insert({
          organization_id: activeOrgId,
          vehicle_id: (vehicle as { id: string }).id,
          customer_name: lead.customer_name,
          claim_number: lead.claim_number,
          stage: 'INTAKE',
          hold_gate_active: false,
        })
        .select('id')
        .single();
      if (roError || !ro) throw new Error(`Repair order creation failed: ${roError?.message}`);

      // Archive lead status so it drops off the Sales intake queue. Best-effort
      // (non-fatal): a lead sourced from the local-cache fallback above has no
      // matching DB row to update, and that must not block RO creation.
      const { error: updateError } = await supabase
        .from(LEADS_TABLE)
        .update({ status: 'CONVERTED' })
        .eq('id', normalizedLeadId);
      if (updateError) {
        console.warn(`[sales-db] lead status archive failed for ${leadId}:`, updateError.message);
      }

      const roId = String((ro as { id: string }).id);
      leadRoMap.set(leadId, roId);

      // Seed the initial SALES assignment from the lead's intake owner so the
      // accountability chain continues onto the floor. Non-fatal on failure.
      if (lead.assigned_staff_name) {
        try {
          await assignStaff(roId, {
            staffId: lead.assigned_staff_id,
            staffName: lead.assigned_staff_name,
            role: 'SALES',
          });
        } catch {
          /* assignment is best-effort — never block the conversion */
        }
      }

      const localLead = localLeads.find((l) => l.id === leadId);
      if (localLead) localLead.status = 'CONVERTED';
      return roId;
    } catch (err) {
      // The checklist gate above is a business-rule stop, not an
      // infrastructure failure — it must reach the caller, not degrade
      // into a silently-provisioned RO via the local bridge below.
      if (err instanceof CarrierChecklistIncompleteError) throw err;
      console.error('True DB conversion failed, falling back to local bridge:', err);
      /* falls through to the local sandbox bridge below */
    }
  }

  // 4. Fallback: local Ops-board bridge (when DB tables or orgs are missing).
  const localLead = localLeads.find((l) => l.id === leadId);
  if (localLead) localLead.status = 'CONVERTED';
  const roId = await bridgeIntakeToOps(leadId);
  if (localLead?.assignedStaffName) {
    await assignStaff(roId, {
      staffId: localLead.assignedStaffId,
      staffName: localLead.assignedStaffName,
      role: 'SALES',
    });
  }
  return roId;
}

/**
 * Revives a terminated lead (CANCELLED / LOST / LOST_TO_COMPETITOR) back into
 * the pipeline and converts it into a Production RO. Returns a result object.
 */
export async function resurrectAndConvertLead(
  leadId: string,
): Promise<{ success: boolean; roId?: string; error?: string }> {
  ensureSeed();
  const lead = localLeads.find((l) => l.id === leadId);
  if (!lead) return { success: false, error: `Lead ${leadId} not found` };

  try {
    if (
      lead.status === 'CANCELLED' ||
      lead.status === 'LOST' ||
      lead.status === 'LOST_TO_COMPETITOR'
    ) {
      lead.status = 'CONTACTED'; // revive before conversion
    }
    const organizationId = await resolveOrganizationId();
    const roId = await convertLeadToRO(leadId, organizationId); // sets CONVERTED + bridges
    return { success: true, roId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Resurrection failed',
    };
  }
}
