/**
 * MESH Sales & Intake — data access layer.
 *
 * Lead pipeline reads/writes with a session-local fallback (seeded from mock)
 * when the intake_leads table is unavailable, plus convertLeadToRO which drops
 * an approved lead onto the Ops production floor as a new INTAKE repair order.
 */
import { getSupabaseBrowserClient, type MeshSupabaseClient } from './supabase';
import { executeDBOperation } from './db-guard';
import { getCurrentProfile } from './auth';
import { MOCK_LEADS } from './sales-mock';
import { MOCK_BOARD_ORDERS } from './ops-mock';
import { bridgeRepairOrder } from '@/app/actions/intake-bridge';
import { seedSalesAssignment } from '@/app/actions/seed-sales-assignment';
import { dispatchMobileUnit, advanceDispatchStatus } from '@/app/actions/dispatch';
import { getCarrierIntel, CHECKLIST_ITEM_LABEL } from '@/lib/carrier-intel';
import type {
  DamageType,
  DispatchStatus,
  IntakeDocKind,
  IntakeDocumentRef,
  IntakeLead,
  IntakeSubmission,
  LeadChannel,
  LeadStatus,
  LeadVehicle,
  PendingVehicleDocument,
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
  repair_order_id?: string | null;
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
  agreement_accepted_at?: string | null;
  rental_agreement_signature_url?: string | null;
  rental_agreement_accepted?: boolean | null;
  rental_agreement_signed_at?: string | null;
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
    documents: Array.isArray(row.documents) ? (row.documents as unknown as IntakeDocumentRef[]) : undefined,
    routingPath: row.routing_path ?? undefined,
    dispatchStaffName: row.dispatch_staff_name ?? undefined,
    dispatchStatus: row.dispatch_status ?? undefined,
    policyholderMatch: row.policyholder_match ?? undefined,
    proxyPolicyholder: row.proxy_policyholder ?? undefined,
    remoteAobStatus: row.remote_aob_status ?? undefined,
    remoteAobToken: row.remote_aob_token ?? undefined,
    address: row.address ?? undefined,
    damageType: row.damage_type ?? undefined,
    agreementAcceptedAt: row.agreement_accepted_at ?? undefined,
    rentalAgreementSignatureUrl: row.rental_agreement_signature_url ?? undefined,
    rentalAgreementAccepted: row.rental_agreement_accepted ?? undefined,
    rentalAgreementSignedAt: row.rental_agreement_signed_at ?? undefined,
  };
}

/**
 * Thrown by convertLeadToRO's carrier-checklist gate. Deliberately a
 * distinct type so the DB-flow's broad catch (infrastructure failures →
 * fall back to the local bridge) can single it out and rethrow instead of
 * silently degrading a business-rule stop into a silently-provisioned RO.
 */
class CarrierChecklistIncompleteError extends Error {}

/** RFC4122-shaped UUID — used both to tell an app-created lead id apart from
 *  a seed-style short id, and to validate a candidate sales-rep id before
 *  querying with it (see resolveSalesRepId below). */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

// ---------------------------------------------------------------------------
// Vehicle Documents — Storage-backed file attachments, one row per file.
//
// Replaces the old intake_leads.documents/damage_photos jsonb-array design
// (base64 data URLs inline in the row — see the incident this migration
// exists to fix) with vehicle_documents: real Storage objects, one row per
// file, keyed to lead_vehicle_id. No local/session fallback here, unlike
// the rest of this file — a failed upload or DB insert is logged and
// returns null/skips, but there's nowhere sensible to locally mirror an
// actual file's bytes the way a lead's status or name can be mirrored.
// ---------------------------------------------------------------------------

const VEHICLE_DOCUMENTS_TABLE = 'vehicle_documents';
const DOCUMENTS_BUCKET = 'documents';

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

const COMPRESS_MAX_DIMENSION = 2000;
const COMPRESS_QUALITY = 0.8;

/**
 * Downscales + re-encodes an image File before it ever reaches Storage — a
 * driver's license photo landed at 12MB uncompressed; twenty hail-panel
 * shots at that size is a gigabyte per vehicle, over cellular. Resizes to a
 * ~2000px long edge (never upscales) and always re-encodes as JPEG at 80%
 * quality, so a large lossless PNG screenshot benefits even when it's
 * already under the size cap. Non-image files (PRIOR_ESTIMATE's
 * json/xml/csv/txt/pdf) pass through untouched — running them through
 * canvas would corrupt them. HEIC decode support is inconsistent outside
 * Safari; any decode/encode failure falls back to uploading the original
 * file rather than failing the upload — the bucket's 15MB hard limit is the
 * real backstop either way.
 */
async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, COMPRESS_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', COMPRESS_QUALITY),
    );
    if (!blob) return file;

    const compressedName = `${file.name.replace(/\.[^./]+$/, '')}.jpg`;
    return new File([blob], compressedName, { type: 'image/jpeg' });
  } catch (err) {
    console.warn(`[sales-db] image compression failed for ${file.name}, uploading original:`, err);
    return file;
  } finally {
    bitmap?.close();
  }
}

/**
 * Creates (or returns the existing) is_primary lead_vehicles row for a lead
 * — the anchor every document upload attaches to. Idempotent against
 * lead_vehicles_primary_unique: an insert failure (most likely a
 * unique-violation from a retry or double-submit racing another call) falls
 * through to selecting the row that already exists, rather than treating a
 * race as a hard failure. Returns null (never throws) on any DB failure —
 * callers treat a null lead_vehicle_id as "documents can't attach this
 * time," not as a reason to fail the whole lead save.
 */
async function ensurePrimaryLeadVehicle(
  leadId: string,
  fields: { vehicleYear?: number; vehicleMake?: string; vehicleModel?: string; vinLast8?: string },
): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  try {
    const { data: inserted, error: insertError } = await supabase
      .from(LEAD_VEHICLES_TABLE)
      .insert({
        lead_id: leadId,
        vehicle_year: fields.vehicleYear ?? null,
        vehicle_make: fields.vehicleMake ?? null,
        vehicle_model: fields.vehicleModel ?? null,
        vin: fields.vinLast8 ?? null,
        is_primary: true,
      })
      .select('id')
      .maybeSingle();
    if (!insertError && inserted) return (inserted as { id: string }).id;

    const { data: existing } = await supabase
      .from(LEAD_VEHICLES_TABLE)
      .select('id')
      .eq('lead_id', leadId)
      .eq('is_primary', true)
      .maybeSingle();
    return existing ? (existing as { id: string }).id : null;
  } catch (err) {
    console.warn(`[sales-db] ensurePrimaryLeadVehicle failed for lead ${leadId}:`, err);
    return null;
  }
}

/**
 * Uploads one file to the 'documents' Storage bucket and inserts its
 * vehicle_documents row — the one place that does both, so every write call
 * site funnels through this instead of hand-rolling Storage + DB calls.
 * Best-effort: returns null on failure (Storage or DB), logs a warning,
 * never throws — a failed document upload must not fail the lead/RO save
 * it's attached to.
 */
async function uploadVehicleDocument(
  leadVehicleId: string,
  organizationId: string,
  leadId: string,
  file: File,
  kind: IntakeDocKind,
): Promise<IntakeDocumentRef | null> {
  try {
    const uploadFile = await compressImageFile(file);
    const supabase = getSupabaseBrowserClient();
    const ext = MIME_EXT[uploadFile.type] ?? (uploadFile.name.split('.').pop() || 'bin');
    const path = `${organizationId}/leads/${leadId}/vehicles/${leadVehicleId}/documents/${kind}-${genUuid()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, uploadFile, { contentType: uploadFile.type || undefined, upsert: false });
    if (uploadError) {
      console.warn(
        `[sales-db] Storage upload failed for ${kind} on lead_vehicle ${leadVehicleId}:`,
        uploadError.message,
      );
      return null;
    }

    const { data: row, error: insertError } = await supabase
      .from(VEHICLE_DOCUMENTS_TABLE)
      .insert({
        organization_id: organizationId,
        lead_vehicle_id: leadVehicleId,
        kind,
        file_name: uploadFile.name,
        storage_path: path,
        byte_size: uploadFile.size,
        mime_type: uploadFile.type || null,
      })
      .select('id')
      .single();
    if (insertError || !row) {
      console.warn(
        `[sales-db] vehicle_documents insert failed for ${kind} on lead_vehicle ${leadVehicleId}:`,
        insertError?.message,
      );
      return null;
    }

    return { id: (row as { id: string }).id, kind, fileName: uploadFile.name, storagePath: path };
  } catch (err) {
    console.warn(`[sales-db] uploadVehicleDocument failed for ${kind} on lead_vehicle ${leadVehicleId}:`, err);
    return null;
  }
}

// Bounded, not unbounded Promise.all — on a cellular uplink the connection
// itself is the bottleneck, not server-side concurrency, so a handful of
// simultaneous uploads gets most of the win without dozens of requests
// fighting over the same pipe.
const UPLOAD_CONCURRENCY = 4;

/**
 * Uploads every pending file for a lead_vehicle, skipping (with a warning)
 * any that individually fail rather than aborting the batch — a save should
 * end with as many documents captured as possible, not zero because one
 * upload failed. Returns [] without attempting anything if leadVehicleId is
 * null (ensurePrimaryLeadVehicle failed) — there's nowhere to attach to.
 *
 * Runs up to UPLOAD_CONCURRENCY uploads at once via a small worker pool
 * rather than one at a time — uploadVehicleDocument already never throws
 * (returns null and logs on failure), so a worker just moves on to the next
 * file; nothing here needs its own try/catch to preserve that semantics.
 */
async function uploadPendingDocuments(
  leadVehicleId: string | null,
  organizationId: string,
  leadId: string,
  pending: PendingVehicleDocument[],
): Promise<IntakeDocumentRef[]> {
  if (!leadVehicleId || pending.length === 0) return [];
  const uploaded: IntakeDocumentRef[] = [];
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const doc = pending[next++];
      const ref = await uploadVehicleDocument(leadVehicleId, organizationId, leadId, doc.file, doc.kind);
      if (ref) uploaded.push(ref);
    }
  };
  const workerCount = Math.min(UPLOAD_CONCURRENCY, pending.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return uploaded;
}

/**
 * Uploads a signature/rental-signature capture — a small base64 PNG held
 * transiently in wizard state (kilobytes, not the multi-MB photos that
 * caused the original incident, so keeping it in memory as base64 until
 * this call is fine) — to Storage, returning the object path to persist
 * instead of writing the base64 itself into the DB. Best-effort: returns
 * null on any failure, same as every other write in this file.
 */
async function uploadSignature(
  organizationId: string,
  leadId: string,
  dataUrl: string,
  fileNamePrefix: string,
): Promise<string | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const ext = MIME_EXT[blob.type] ?? 'png';
    const path = `${organizationId}/leads/${leadId}/${fileNamePrefix}-${genUuid()}.${ext}`;

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, blob, { contentType: blob.type || 'image/png', upsert: false });
    if (error) {
      console.warn(`[sales-db] signature upload failed for lead ${leadId}:`, error.message);
      return null;
    }
    return path;
  } catch (err) {
    console.warn(`[sales-db] uploadSignature failed for lead ${leadId}:`, err);
    return null;
  }
}

/**
 * Lists a vehicle's captured documents, most recent first. Bounded at 100 —
 * proportionate to a Sales-side lead drawer, not the hundreds-per-vehicle
 * volume a hail job can produce on the Ops/RO side (that needs real
 * pagination, not built here).
 */
export async function listVehicleDocuments(leadVehicleId: string): Promise<IntakeDocumentRef[]> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(VEHICLE_DOCUMENTS_TABLE)
      .select('id, kind, file_name, storage_path')
      .eq('lead_vehicle_id', leadVehicleId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error || !data) return [];
    return (data as { id: string; kind: IntakeDocKind; file_name: string | null; storage_path: string }[]).map(
      (row) => ({
        id: row.id,
        kind: row.kind,
        fileName: row.file_name ?? '',
        storagePath: row.storage_path,
      }),
    );
  } catch {
    return [];
  }
}

/**
 * Removes a document: deletes the Storage object, then the row. A Storage
 * failure still proceeds to delete the row rather than leaving a reference
 * the UI keeps showing for an object that may or may not still exist.
 */
export async function removeVehicleDocument(documentId: string): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data: row, error: fetchError } = await supabase
      .from(VEHICLE_DOCUMENTS_TABLE)
      .select('storage_path')
      .eq('id', documentId)
      .maybeSingle();
    if (fetchError || !row) return;

    const { error: removeError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([(row as { storage_path: string }).storage_path]);
    if (removeError) {
      console.warn(`[sales-db] Storage remove failed for document ${documentId}:`, removeError.message);
    }

    const { error: deleteError } = await supabase.from(VEHICLE_DOCUMENTS_TABLE).delete().eq('id', documentId);
    if (deleteError) {
      console.warn(`[sales-db] vehicle_documents delete failed for ${documentId}:`, deleteError.message);
    }
  } catch (err) {
    console.warn(`[sales-db] removeVehicleDocument failed for ${documentId}:`, err);
  }
}

// Session-local store of full intake packages (document refs + signature +
// walkaround), keyed by the created lead id.
const intakePackages: Record<string, IntakeSubmission> = {};

// Uploaded vehicle_documents refs for a just-saved intake, keyed by lead id.
// IntakeSubmission.documents is not used for this anymore (see
// saveIntakePackage) — bridgeIntakeToOps reads the real, already-uploaded
// refs from here instead, since a base64/blob string was never a valid
// storagePath to begin with.
const leadDocumentsCache = new Map<string, IntakeDocumentRef[]>();

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

  // Candidate id — used if bridgeRepairOrder actually inserts a new row.
  // Set into leadRoMap immediately (not after the await below) so a
  // concurrent re-entrant call in this same session sees the early-return
  // guard above instead of racing its own insert; corrected below if
  // bridgeRepairOrder instead adopts an existing durably-linked RO.
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
  //
  // finalRoId may differ from the candidate roId above: bridgeRepairOrder is
  // idempotent per lead (intake_leads.repair_order_id) and returns an
  // existing linked RO instead of inserting a second one when this lead
  // already has one.
  let finalRoId = roId;
  try {
    const result = await bridgeRepairOrder({
      id: roId,
      leadId,
      customerName: lead.customerName,
      claimNumber: lead.claimNumber || null,
      organizationId: organizationId || null,
    });
    if (result.success && result.roId) {
      finalRoId = result.roId;
      if (finalRoId !== roId) leadRoMap.set(leadId, finalRoId);
    } else if (!result.success) {
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
    id: finalRoId,
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
    intakeDocuments: (leadDocumentsCache.get(leadId) ?? []).map((d) => ({
      kind: d.kind,
      fileName: d.fileName,
      storagePath: d.storagePath ?? null,
    })),
  });
  return finalRoId;
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
export async function saveIntakePackage(
  submission: IntakeSubmission,
  pendingDocuments: PendingVehicleDocument[] = [],
): Promise<IntakeLead> {
  ensureSeed();
  // Resolves the caller's org or throws — a lead can never be written
  // (DB or local fallback) without one. Runs before any write, local
  // included, so a failure here blocks the whole function, not just the DB
  // insert's best-effort path below.
  const organizationId = await resolveOrganizationId();
  const id = genId('lead');
  const status: LeadStatus = submission.signatureDataUrl ? 'AOB_SIGNED' : 'NEW';
  const policyholderMatch = submission.policyholderMatch ?? true;

  // Signatures upload to Storage before the insert, same as every other
  // document — the DB only ever holds a storage path, never base64. Small
  // (kilobytes) and short-lived in memory as base64 until this call, unlike
  // the multi-MB photos that caused the original incident.
  const signatureUrl = submission.signatureDataUrl
    ? await uploadSignature(organizationId, id, submission.signatureDataUrl, 'signature')
    : null;
  const rentalSignatureUrl = submission.rentalAgreementSignatureDataUrl
    ? await uploadSignature(organizationId, id, submission.rentalAgreementSignatureDataUrl, 'rental-signature')
    : null;

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
    agreementAcceptedAt: submission.agreementAcceptedAt || undefined,
    rentalAgreementAccepted: Boolean(submission.rentalAgreementSignatureDataUrl),
    rentalAgreementSignatureUrl: rentalSignatureUrl || undefined,
    rentalAgreementSignedAt: submission.rentalAgreementSignatureDataUrl
      ? submission.agreementAcceptedAt || undefined
      : undefined,
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
      documents: [],
      walkaround_notes: submission.walkaround,
      signature_url: signatureUrl,
      status: lead.status,
      created_at: lead.intakeDate,
      agreement_accepted: lead.agreementAccepted ?? false,
      agreement_accepted_at: lead.agreementAcceptedAt ?? null,
      rental_agreement_signature_url: rentalSignatureUrl,
      rental_agreement_accepted: lead.rentalAgreementAccepted ?? false,
      rental_agreement_signed_at: lead.rentalAgreementSignedAt ?? null,
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

  // Primary lead_vehicles row + document uploads, after the insert attempt
  // above but not gated on it succeeding — ensurePrimaryLeadVehicle/
  // uploadPendingDocuments are their own best-effort calls and simply
  // return null/[] if intake_leads or lead_vehicles aren't reachable.
  const leadVehicleId = await ensurePrimaryLeadVehicle(id, {
    vehicleYear: submission.vehicleYear,
    vehicleMake: submission.vehicleMake,
    vehicleModel: submission.vehicleModel,
    vinLast8: submission.vinLast8,
  });
  const uploadedDocs = await uploadPendingDocuments(leadVehicleId, organizationId, id, pendingDocuments);
  leadDocumentsCache.set(id, uploadedDocs);
  lead.documents = uploadedDocs.length > 0 ? uploadedDocs : undefined;

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
   *  estimate, dynamic carrier checklist, damage photos) — held as pending
   *  Files, uploaded to Storage after the lead + primary vehicle exist. */
  documents: PendingVehicleDocument[];
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
      documents: [],
      walkaround_notes: [],
      status: lead.status,
      created_at: lead.intakeDate,
      channel: lead.channel,
      storm_tag: lead.stormTag ?? null,
      zip_code: lead.zipCode ?? null,
      severity: lead.severity ?? null,
      damage_photos: [],
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

  const leadVehicleId = await ensurePrimaryLeadVehicle(id, {
    vehicleYear: input.vehicleYear,
    vehicleMake: input.vehicleMake,
    vehicleModel: input.vehicleModel,
  });
  const uploadedDocs = await uploadPendingDocuments(leadVehicleId, organizationId, id, input.documents);
  lead.documents = uploadedDocs.length > 0 ? uploadedDocs : undefined;
  lead.damagePhotos = uploadedDocs.filter((d) => d.kind === 'DAMAGE_PHOTO');

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

  // Same owner-capture as MobileIntakeWizard (assignedStaffId defaults to
  // the signed-in rep's session, overridable later via assignLeadStaff) —
  // this path never set it before, leaving every quick-captured lead
  // ownerless. Best-effort, unlike organizationId above: a missing/failed
  // session lookup must not block a quick capture, it just leaves the lead
  // unowned for manual assignment.
  let assignedStaffId: string | undefined;
  let assignedStaffName: string | undefined;
  try {
    const profile = await getCurrentProfile(getSupabaseBrowserClient());
    if (profile) {
      assignedStaffId = profile.authUserId;
      assignedStaffName = profile.fullName || profile.email || undefined;
    }
  } catch {
    /* no session — leave owner blank for manual assignment */
  }

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
    assignedStaffId,
    assignedStaffName,
    documents: [],
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
      assigned_staff_id: lead.assignedStaffId ?? null,
      assigned_staff_name: lead.assignedStaffName ?? null,
    });
    if (error) {
      /* fall through to local store */
    }
  } catch {
    /* fall through to local store */
  }

  // No documents captured at this flow — vehicle fields are largely empty
  // too (a quick porch capture is name-first, everything else filled in
  // later) — but the primary lead_vehicles row still needs to exist now, so
  // a later LeadDetailDrawer upload has somewhere to attach to.
  await ensurePrimaryLeadVehicle(id, { vehicleMake });

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

/** Fields the Lead Detail Drawer may correct after intake. Partial by
 *  design — omitted keys are left untouched, never overwritten. Deliberately
 *  has no organizationId/id/status/createdAt: those are not patchable
 *  through this function at all. */
export interface LeadDetailsPatch {
  customerName?: string;
  phone?: string;
  email?: string;
  address?: string;
  vehicleYear?: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vinLast8?: string;
  insuranceCarrier?: string;
  claimNumber?: string;
  damageType?: DamageType;
  estimatedAmount?: number;
}

/**
 * Corrects a saved lead's details after intake — the fields a rep gets
 * wrong at the door and fixes later, not status/ownership/routing (those
 * have their own functions). Same shape as assignLeadStaff: browser client,
 * .update({...}), .eq('id', id), .select('id'), fall through to the
 * localLeads mirror on failure. Only keys present in `patch` are written;
 * an empty patch is a no-op rather than an empty UPDATE.
 */
export async function updateLeadDetails(id: string, patch: LeadDetailsPatch): Promise<void> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.customerName !== undefined) dbPatch.customer_name = patch.customerName;
  if (patch.phone !== undefined) dbPatch.phone = patch.phone;
  if (patch.email !== undefined) dbPatch.email = patch.email;
  if (patch.address !== undefined) dbPatch.address = patch.address;
  if (patch.vehicleYear !== undefined) dbPatch.vehicle_year = patch.vehicleYear;
  if (patch.vehicleMake !== undefined) dbPatch.vehicle_make = patch.vehicleMake;
  if (patch.vehicleModel !== undefined) dbPatch.vehicle_model = patch.vehicleModel;
  if (patch.vinLast8 !== undefined) dbPatch.vin_last8 = patch.vinLast8;
  if (patch.insuranceCarrier !== undefined) dbPatch.insurance_carrier = patch.insuranceCarrier;
  if (patch.claimNumber !== undefined) dbPatch.claim_number = patch.claimNumber;
  if (patch.damageType !== undefined) dbPatch.damage_type = patch.damageType;
  if (patch.estimatedAmount !== undefined) dbPatch.estimated_amount = patch.estimatedAmount;
  if (Object.keys(dbPatch).length === 0) return;

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(LEADS_TABLE)
      .update(dbPatch)
      .eq('id', id)
      .select('id');
    if (!error && data && data.length > 0) {
      applyLeadDetailsPatchLocally(id, patch);
      return;
    }
  } catch {
    /* fall through to local */
  }
  applyLeadDetailsPatchLocally(id, patch);
}

function applyLeadDetailsPatchLocally(id: string, patch: LeadDetailsPatch): void {
  ensureSeed();
  const lead = localLeads.find((l) => l.id === id);
  if (!lead) return;
  if (patch.customerName !== undefined) lead.customerName = patch.customerName;
  if (patch.phone !== undefined) lead.phone = patch.phone;
  if (patch.email !== undefined) lead.email = patch.email;
  if (patch.address !== undefined) lead.address = patch.address;
  if (patch.vehicleYear !== undefined) lead.vehicleYear = patch.vehicleYear;
  if (patch.vehicleMake !== undefined) lead.vehicleMake = patch.vehicleMake;
  if (patch.vehicleModel !== undefined) lead.vehicleModel = patch.vehicleModel;
  if (patch.vinLast8 !== undefined) lead.vinLast8 = patch.vinLast8;
  if (patch.insuranceCarrier !== undefined) lead.insuranceCarrier = patch.insuranceCarrier;
  if (patch.claimNumber !== undefined) lead.claimNumber = patch.claimNumber;
  if (patch.damageType !== undefined) lead.damageType = patch.damageType;
  if (patch.estimatedAmount !== undefined) lead.estimatedAmount = patch.estimatedAmount;
}

/**
 * Uploads one document for an existing lead's primary vehicle — resolves
 * (or creates, if somehow missing) the primary lead_vehicles row, then
 * uploads via uploadVehicleDocument. The entry point for post-intake
 * uploads (e.g. LeadDetailDrawer), where the lead already exists so there's
 * no sequencing problem: this uploads immediately, not deferred like the
 * wizard flows in saveIntakePackage/createDigitalLead above.
 *
 * Replaces addLeadDocument/removeLeadDocument's old read-modify-write
 * against intake_leads.documents (kind-only removal, no way to tell two
 * DAMAGE_PHOTOs apart) — removal is now removeVehicleDocument(documentId),
 * targeting one row, not "every document of this kind."
 */
export async function addVehicleDocument(
  leadId: string,
  file: File,
  kind: IntakeDocKind,
): Promise<IntakeDocumentRef | null> {
  try {
    const organizationId = await resolveOrganizationId();
    const leadVehicleId = await ensurePrimaryLeadVehicle(leadId, {});
    if (!leadVehicleId) return null;
    return uploadVehicleDocument(leadVehicleId, organizationId, leadId, file, kind);
  } catch (err) {
    console.warn(`[sales-db] addVehicleDocument failed for lead ${leadId}:`, err);
    return null;
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
 *
 * Accepts an optional client so a server caller (a Route Handler, which has
 * no browser cookies) can pass a session-bearing client instead of silently
 * getting getSupabaseBrowserClient()'s default — see convertLeadToRO below
 * for why that default is wrong outside an actual browser.
 */
async function resolveOrganizationId(client?: MeshSupabaseClient): Promise<string> {
  const profile = await getCurrentProfile(client ?? getSupabaseBrowserClient());
  if (profile?.organizationId) return profile.organizationId;
  throw new Error('Cannot resolve organization for the current session');
}

/**
 * Resolves intake_leads.assigned_staff_id to the public.users.id that
 * repair_orders.sales_rep_id actually references. assigned_staff_id holds an
 * auth.users.id (captured from the signed-in rep's session at intake — see
 * MobileIntakeWizard/createQuickLead), not a public.users.id, so it must be
 * looked up via users.auth_user_id before it can be used as sales_rep_id.
 *
 * Returns null rather than guessing when the value doesn't look like a UUID
 * (demo/seed placeholders like 'staff-avery' — querying with one of those
 * would 400 as an invalid uuid literal anyway) or doesn't match any users
 * row (deleted user, stale/foreign auth id). A wrong owner is worse than no
 * owner, so any lookup miss falls through to null, never a guess.
 */
async function resolveSalesRepId(
  supabase: MeshSupabaseClient,
  assignedStaffId: string | null | undefined,
): Promise<string | null> {
  if (!assignedStaffId || !UUID_REGEX.test(assignedStaffId)) return null;
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', assignedStaffId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

/**
 * Resolves the display name to record on the initial SALES order_assignments
 * row. intake_leads.assigned_staff_name is not trustworthy as a display name
 * on its own — it can be null even when a real assigned_staff_id exists
 * (confirmed live: lead 'Pamela Anderson' has a real auth.uid()-derived
 * assigned_staff_id and a null assigned_staff_name), and historically could
 * hold an email address instead of a name (MobileIntakeWizard fallback bug,
 * fixed separately) — so the name is looked up fresh from
 * public.users.full_name by auth_user_id rather than trusted from the lead
 * row. Falls back to whatever the lead row holds only when no users row
 * matches, so a resolvable id still gets *a* name rather than none.
 */
async function resolveSalesRepDisplayName(
  supabase: MeshSupabaseClient,
  assignedStaffId: string | null | undefined,
  fallbackName: string | null | undefined,
): Promise<string | null> {
  if (assignedStaffId && UUID_REGEX.test(assignedStaffId)) {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('full_name, email')
        .eq('auth_user_id', assignedStaffId)
        .maybeSingle();
      if (!error && data) {
        const row = data as { full_name: string | null; email: string | null };
        if (row.full_name) return row.full_name;
        if (row.email) return row.email;
      }
    } catch {
      /* DB unreachable — fall through to fallbackName below, same as every
         other best-effort lookup in this file. */
    }
  }
  return fallbackName || null;
}

/**
 * Converts an approved lead into an active Production RO and returns the new RO
 * id. When an organizationId is available it runs the real multi-step DB flow
 * (provision vehicle → insert repair_order → archive the lead as CONVERTED);
 * on any DB error, a missing org, or an unmigrated table it falls back to the
 * shared local Ops-board bridge so the RO is still visible on the floor.
 * Idempotent per lead.
 *
 * `client` defaults to getSupabaseBrowserClient() — correct for every
 * existing browser-side caller. A server caller (e.g. convert/route.ts,
 * which has no browser cookies for that client to read) MUST pass its own
 * session-bearing client explicitly, or every query below runs as an
 * unauthenticated anon/no-session client: RLS then silently returns zero
 * rows for a lead that genuinely exists — not an error, just "not found"
 * (confirmed live: a real row with organization_id 021a9386-... came back
 * empty under the default browser client called server-side).
 */
export async function convertLeadToRO(
  leadId: string,
  organizationId?: string,
  client?: MeshSupabaseClient,
): Promise<string> {
  ensureSeed();
  const cached = leadRoMap.get(leadId);
  if (cached) return cached;

  // If no org id was passed, resolve from the current session, falling back
  // to the first DB org (dev fallback) — see resolveOrganizationId().
  const activeOrgId = organizationId || (await resolveOrganizationId(client));

  // genId('lead') produces 'lead-<uuid>', and intake_leads.id stores that
  // FULL prefixed string verbatim — confirmed against live data, including
  // for app-created leads, not just seed rows like 'lead-1005'. The prefix
  // is real, stored data, never stripped before insert. leadIdSuffix exists
  // ONLY to test whether this id's suffix (after discounting the prefix) is
  // itself a real generated UUID — that's how we tell an app-created lead
  // ('lead-1d970b31-...') apart from a seed-style short id ('lead-1005').
  // It must NEVER be used to query the database — leadId (prefix intact) is
  // what's actually stored and must be queried against.
  const leadIdSuffix = leadId.startsWith('lead-') ? leadId.slice('lead-'.length) : leadId;

  // 3. If an organization was secured and the id's suffix is a valid
  // database UUID (i.e. this is an app-created lead, not a seed-style
  // short id), attempt the true multi-step DB flow.
  if (activeOrgId && UUID_REGEX.test(leadIdSuffix)) {
    try {
      const supabase = client ?? getSupabaseBrowserClient();

      const { data, error: leadError } = await supabase
        .from(LEADS_TABLE)
        .select('*')
        .eq('id', leadId)
        .maybeSingle();
      if (leadError) throw new Error(`Failed to fetch lead: ${leadError.message}`);

      let lead = data as unknown as LeadRow | null;

      // Graceful local fallback: zero rows (e.g. an unpersisted mock/seed
      // lead) is not a hard failure — intercept the miss, pull the payload
      // from the active local cache, and continue provisioning the RO from
      // it instead of throwing.
      //
      // documents/walkaround_notes below are placeholder values on this
      // reconstructed row — they're vestigial now that the carrier-checklist
      // gate a few lines down reads vehicle_documents (via lead_vehicles,
      // queried independently of this row) rather than an intake_leads.
      // documents jsonb value, so this branch no longer under-reports
      // captured documents the way it used to.
      //
      // Only for browser callers (no explicit client). localLeads is
      // module-scope state private to whichever JS runtime is executing —
      // a server caller's copy only ever holds the 8 hardcoded MOCK_LEADS,
      // never anything a real user created in their own browser tab, so
      // this branch could never legitimately succeed there. Worse, letting
      // it "succeed" from mock data would have an API route report
      // { success: true, roId } for a lead it never actually found — a
      // fabricated success is worse than a clear 400. A server caller
      // (client passed) skips straight to the throw below instead.
      if (!lead && !client) {
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
      // Server caller, zero DB rows: propagate a clear "not found" instead
      // of dereferencing a null lead a few lines down.
      if (!lead) throw new Error(`Lead ${leadId} not found`);

      // Resolved once, used by both the checklist gate below and the
      // vehicle_documents.repair_order_id backfill after RO creation.
      const { data: primaryVehicle } = await supabase
        .from(LEAD_VEHICLES_TABLE)
        .select('id')
        .eq('lead_id', leadId)
        .eq('is_primary', true)
        .maybeSingle();
      const leadVehicleId = primaryVehicle ? (primaryVehicle as { id: string }).id : null;

      // Carrier-checklist gate — moved here from MobileIntakeWizard's step-2
      // canProceed(), which used to block the LEAD from being saved at all.
      // Now the lead always saves; this blocks only RO provisioning, naming
      // exactly what's missing so an office coordinator knows what to chase.
      // Reads vehicle_documents directly rather than an intake_leads.
      // documents jsonb snapshot — a missing leadVehicleId (e.g. a
      // pre-fan-out lead with no primary row yet) means an empty captured
      // set, same as any other lead with no documents.
      const requiredChecklist = getCarrierIntel(lead.insurance_carrier ?? '').requiredChecklist;
      if (requiredChecklist.length > 0) {
        const capturedKinds = new Set<IntakeDocKind>();
        if (leadVehicleId) {
          const { data: docs } = await supabase
            .from(VEHICLE_DOCUMENTS_TABLE)
            .select('kind')
            .eq('lead_vehicle_id', leadVehicleId);
          for (const row of (docs ?? []) as { kind: IntakeDocKind }[]) capturedKinds.add(row.kind);
        }
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
      const vehicleId = (vehicle as { id: string }).id;
      const salesRepId = await resolveSalesRepId(supabase, lead.assigned_staff_id);

      // If bridgeIntakeToOps already created and durably linked a
      // repair_order for this lead (intake_leads.repair_order_id — see
      // 20260805000000_intake_leads_repair_order_link.sql), adopt it
      // instead of inserting a second one: a second insert with the same
      // claim_number collides with repair_orders_org_claim_unique
      // (confirmed live — reproduced with lead 'Pamela Anderson' during
      // sales-rep-ownership testing). bridgeIntakeToOps's own insert never
      // sets vehicle_id or sales_rep_id, so this still attaches both.
      let roId: string;
      if (lead.repair_order_id) {
        roId = lead.repair_order_id;
        const { error: adoptError } = await supabase
          .from('repair_orders')
          .update({ vehicle_id: vehicleId, sales_rep_id: salesRepId })
          .eq('id', roId);
        if (adoptError) throw new Error(`Repair order update failed: ${adoptError.message}`);
      } else {
        // Insert the active repair order (no `vin` column on repair_orders).
        const { data: ro, error: roError } = await supabase
          .from('repair_orders')
          .insert({
            organization_id: activeOrgId,
            vehicle_id: vehicleId,
            customer_name: lead.customer_name,
            claim_number: lead.claim_number,
            stage: 'INTAKE',
            hold_gate_active: false,
            sales_rep_id: salesRepId,
          })
          .select('id')
          .single();
        if (roError || !ro) throw new Error(`Repair order creation failed: ${roError?.message}`);
        roId = String((ro as { id: string }).id);
      }

      // Archive lead status so it drops off the Sales intake queue, and
      // durably record the lead -> RO link (a no-op update when adopted,
      // since it's already set). Best-effort (non-fatal): a lead sourced
      // from the local-cache fallback above has no matching DB row to
      // update, and that must not block RO creation.
      const { error: updateError } = await supabase
        .from(LEADS_TABLE)
        .update({ status: 'CONVERTED', repair_order_id: roId })
        .eq('id', leadId);
      if (updateError) {
        console.warn(`[sales-db] lead status archive failed for ${leadId}:`, updateError.message);
      }

      leadRoMap.set(leadId, roId);

      // Durably attach this vehicle's already-uploaded documents to the RO,
      // so Ops-side reads (RODetailDrawer, invoice, proof-of-payment) can
      // index on repair_order_id directly with no join back through
      // lead_vehicles. Non-fatal: a failure here leaves documents reachable
      // via lead_vehicle_id only, which still works, just not on the RO-side
      // query path.
      if (leadVehicleId) {
        const { error: backfillError } = await supabase
          .from(VEHICLE_DOCUMENTS_TABLE)
          .update({ repair_order_id: roId })
          .eq('lead_vehicle_id', leadVehicleId)
          .is('repair_order_id', null);
        if (backfillError) {
          console.warn(
            `[sales-db] vehicle_documents repair_order_id backfill failed for RO ${roId}:`,
            backfillError.message,
          );
        }
      }

      // Seed the initial SALES assignment from the lead's intake owner so the
      // accountability chain continues onto the floor. Gated on
      // assigned_staff_id, not assigned_staff_name — the id is what makes
      // this attributable, and a real id can exist with a null name (see
      // resolveSalesRepDisplayName). Non-fatal on failure.
      if (lead.assigned_staff_id) {
        const staffName = await resolveSalesRepDisplayName(
          supabase,
          lead.assigned_staff_id,
          lead.assigned_staff_name,
        );
        if (staffName) {
          // Server Action, not assignStaff: SALES has no order_assignments
          // write grant (by design — see seed-sales-assignment.ts), so this
          // insert has to run privileged, server-side. Best-effort — never
          // block the conversion — but silent before today, which is
          // exactly how Leighton McClendon's RO ended up with no
          // order_assignments row and no trace of why.
          try {
            const result = await seedSalesAssignment({
              repairOrderId: roId,
              staffId: lead.assigned_staff_id,
              staffName,
            });
            if (!result.success) {
              console.warn(`[sales-db] initial SALES assignment failed for RO ${roId}:`, result.error);
            }
          } catch (err) {
            console.warn(`[sales-db] initial SALES assignment failed for RO ${roId}:`, err);
          }
        }
      }

      const localLead = localLeads.find((l) => l.id === leadId);
      if (localLead) localLead.status = 'CONVERTED';
      return roId;
    } catch (err) {
      // The checklist gate above is a business-rule stop, not an
      // infrastructure failure — it must reach the caller, not degrade
      // into a silently-provisioned RO via the local bridge below. Same
      // for ANY error when a server client was supplied: the local bridge
      // below matches against localLeads, which for a seed-style id
      // (e.g. 'lead-1005') would still fabricate a "success" even for a
      // server caller — the client check has to gate the whole fallback,
      // not just the not-found branch above.
      if (err instanceof CarrierChecklistIncompleteError || client) throw err;
      console.error('True DB conversion failed, falling back to local bridge:', err);
      /* falls through to the local sandbox bridge below */
    }
  }

  // 4. Fallback: local Ops-board bridge (when DB tables or orgs are missing).
  const localLead = localLeads.find((l) => l.id === leadId);
  if (localLead) localLead.status = 'CONVERTED';
  const roId = await bridgeIntakeToOps(leadId);
  // Gated on assignedStaffId, not assignedStaffName — see the DB-flow branch
  // above for why. Same Server Action as the DB-flow branch, same reason
  // (SALES has no order_assignments write grant). Best-effort — never block
  // RO creation over a staffing write. If bridgeIntakeToOps's own insert
  // (best-effort itself) never actually landed a real repair_orders row,
  // seedSalesAssignment's caller-visibility check fails closed here — safe:
  // it means there's no real RO id to attach an assignment to anyway.
  if (localLead?.assignedStaffId) {
    const staffName = await resolveSalesRepDisplayName(
      getSupabaseBrowserClient(),
      localLead.assignedStaffId,
      localLead.assignedStaffName,
    );
    if (staffName) {
      try {
        const result = await seedSalesAssignment({
          repairOrderId: roId,
          staffId: localLead.assignedStaffId,
          staffName,
        });
        if (!result.success) {
          console.warn(`[sales-db] fallback-path staff assignment failed for RO ${roId}:`, result.error);
        }
      } catch (err) {
        console.warn(`[sales-db] fallback-path staff assignment failed for RO ${roId}:`, err);
      }
    }
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
