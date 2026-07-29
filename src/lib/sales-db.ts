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
import type {
  IntakeLead,
  IntakeSubmission,
  LeadStatus,
} from '@/components/sales/types';

const LEADS_TABLE = 'intake_leads';

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
  vin?: string | null;
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
    vinLast8: row.vin ?? '',
    insuranceCarrier: row.insurance_carrier ?? '',
    claimNumber: row.claim_number ?? '',
    status: row.status,
    intakeDate: row.created_at,
    estimatedAmount: row.estimated_amount ?? 0,
    agreementAccepted: row.agreement_accepted ?? undefined,
    assignedStaffId: row.assigned_staff_id ?? undefined,
    assignedStaffName: row.assigned_staff_name ?? undefined,
  };
}

function genId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
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
    return result.data.map(rowToLead);
  }
  ensureSeed();
  return localLeads.map((l) => ({ ...l }));
}

// Session-local store of full intake packages (document refs + signature +
// walkaround), keyed by the created lead id.
const intakePackages: Record<string, IntakeSubmission> = {};

// Tracks which leads already have a bridged RO, so intake auto-creation and a
// later manual convert don't create duplicate ROs.
const leadRoMap = new Map<string, string>();

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

  const roId = genId('ro');
  leadRoMap.set(leadId, roId);
  const now = new Date().toISOString();

  // Best-effort DB insert — repair_orders carries only core fields.
  try {
    const supabase = getSupabaseBrowserClient();
    await supabase.from('repair_orders').insert({
      id: roId,
      customer_name: lead.customerName,
      claim_number: lead.claimNumber,
      stage: 'INTAKE',
    });
  } catch {
    /* ignore — the local board bridge below is the dev source of truth */
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
 * Persists a mobile intake package as an active lead record: creates the lead
 * (status NEW), stores its document references / signature / walkaround in the
 * session-local package store, and returns the created lead. Attempts a DB
 * insert first; falls back to local storage when the table is unavailable.
 */
export async function saveIntakePackage(submission: IntakeSubmission): Promise<IntakeLead> {
  ensureSeed();
  const id = genId('lead');
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
    status: 'NEW',
    intakeDate: new Date().toISOString(),
    estimatedAmount: submission.estimatedAmount,
    agreementAccepted: Boolean(submission.signatureDataUrl),
    assignedStaffId: submission.assignedStaffId,
    assignedStaffName: submission.assignedStaffName,
  };

  try {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from(LEADS_TABLE).insert({
      id: lead.id,
      customer_name: lead.customerName,
      phone: lead.phone,
      email: lead.email,
      vehicle_year: lead.vehicleYear,
      vehicle_make: lead.vehicleMake,
      vehicle_model: lead.vehicleModel,
      vehicle_info: `${lead.vehicleYear} ${lead.vehicleMake} ${lead.vehicleModel}`.trim(),
      vin: lead.vinLast8,
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
  // floor, carrying the field walkaround / hail / document context.
  await bridgeIntakeToOps(id);
  return lead;
}

/** Updates a lead's pipeline status (DB when available, else local). */
export async function updateLeadStatus(id: string, status: LeadStatus): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(LEADS_TABLE)
      .update({ status })
      .eq('id', id)
      .select('id');
    if (!error && data && data.length > 0) return;
  } catch {
    /* fall through to local */
  }
  ensureSeed();
  const lead = localLeads.find((l) => l.id === id);
  if (lead) lead.status = status;
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

/** Resolves the signed-in user's organization id (browser session), or ''. */
async function resolveOrganizationId(): Promise<string> {
  try {
    const profile = await getCurrentProfile(getSupabaseBrowserClient());
    return profile?.organizationId ?? '';
  } catch {
    return '';
  }
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

  let activeOrgId = organizationId;

  // 1. If no org id was passed, try resolving from the current session.
  if (!activeOrgId) {
    activeOrgId = await resolveOrganizationId();
  }

  // 2. If session is empty, auto-fetch a default org from the DB (dev fallback).
  if (!activeOrgId) {
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: defaultOrg } = await supabase
        .from('organizations')
        .select('id')
        .limit(1)
        .maybeSingle();
      activeOrgId = (defaultOrg as { id: string } | null)?.id ?? '';
    } catch {
      /* ignore — proceed to local fallback if tables aren't there yet */
    }
  }

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // 3. If an organization was secured and the ID is a valid database UUID, run the true multi-step DB flow.
  if (activeOrgId && UUID_REGEX.test(leadId)) {
    try {
      const supabase = getSupabaseBrowserClient();

      const { data, error: leadError } = await supabase
        .from(LEADS_TABLE)
        .select('*')
        .eq('id', leadId)
        .single();
      if (leadError || !data) throw new Error(`Failed to fetch lead: ${leadError?.message}`);
      const lead = data as unknown as LeadRow;

      // Provision vehicle record.
      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert({
          organization_id: activeOrgId,
          vin: lead.vin,
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

      // Archive lead status so it drops off the Sales intake queue.
      const { error: updateError } = await supabase
        .from(LEADS_TABLE)
        .update({ status: 'CONVERTED' })
        .eq('id', leadId);
      if (updateError) throw new Error(`Lead status update failed: ${updateError.message}`);

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
