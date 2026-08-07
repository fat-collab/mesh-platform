/**
 * MESH — backfill vehicle_documents rows for 3 orphaned Storage objects.
 *
 * migrate-lead-documents.mjs (see that file) extracted base64 out of
 * intake_leads.documents into real Storage objects and wrote storagePath
 * back into that same jsonb entry — correct at the time. vehicle_documents
 * has since superseded that column, and the app no longer reads it (see
 * sales-db.ts's rowToLead / LeadDetailDrawer's read-path fix). Nothing in
 * the app can reach these 3 objects today: no vehicle_documents row points
 * at them, and they sit at the pre-lead_vehicles path shape
 * ({org}/leads/{lead_id}/documents/..., no /vehicles/ segment) that predates
 * the current upload convention.
 *
 * The 3 paths below were found by querying storage.objects directly
 * (bucket_id='documents', name like '%/leads/%/documents/%' and name not
 * like '%/vehicles/%') — hardcoded rather than rediscovered by this script,
 * matching migrate-lead-documents.mjs's own convention of a fixed target
 * list for a one-off backfill. Each is still resolved independently below
 * (lead lookup, kind parsing, Storage metadata read) and reported —
 * never silently written or dropped — if anything doesn't check out.
 *
 * For each object:
 *   1. Parses org + lead_id from the path, kind from the filename (matched
 *      against the closed IntakeDocKind set).
 *   2. Resolves the lead's primary lead_vehicles row, creating one if it
 *      doesn't exist yet — mirrors sales-db.ts's ensurePrimaryLeadVehicle
 *      (insert; on conflict, select the row that already exists).
 *   3. Reads byte_size / mime_type from the Storage object's own metadata
 *      (storage.list()'s per-file `metadata.size` / `metadata.mimetype`) —
 *      never guessed from the extension.
 *   4. Recovers the original file_name from the matching entry still
 *      sitting in intake_leads.documents (superseded, unread by the app,
 *      but not deleted — it's the only place the original name survives).
 *      Falls back to the storage-generated filename if no matching entry
 *      exists, and says so.
 *
 * Report-only by default: prints every planned INSERT and every path that
 * couldn't be resolved, writes nothing. Pass --apply to actually insert.
 * Never deletes or modifies anything — not the Storage objects, not the
 * legacy intake_leads.documents column, not existing vehicle_documents rows.
 *
 * Run:
 *   node --env-file=.env.local scripts/backfill-vehicle-documents.mjs
 *   node --env-file=.env.local scripts/backfill-vehicle-documents.mjs --apply
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Not SUPABASE_SERVICE_ROLE_KEY: legacy service_role JWTs are disabled on
// this project. SUPABASE_SECRET_KEY is the new-style key
// createSupabaseServerClient() (src/lib/supabase-server.ts) already uses for
// the same privileged-write purpose.
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;

if (!URL || !SERVICE_KEY || SERVICE_KEY.includes('your_')) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or a real SUPABASE_SECRET_KEY in .env.local.');
  process.exit(1);
}

const supabase = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKET = 'documents';
const APPLY = process.argv.includes('--apply');

const OBJECT_PATHS = [
  '021a9386-da46-4b17-a51d-668ffdd4d179/leads/lead-89fda7ed-f801-4ed1-a585-9df6ad89a810/documents/VIN_TO_DAMAGE_ALIGNMENT-4b051ea5-4c06-4f82-b1b1-98aeef7204bf.png',
  '021a9386-da46-4b17-a51d-668ffdd4d179/leads/lead-89fda7ed-f801-4ed1-a585-9df6ad89a810/documents/LINE_BOARD_SWEEP-75cc6dd6-6622-48d8-a9d9-09799a284c42.jpg',
  '021a9386-da46-4b17-a51d-668ffdd4d179/leads/lead-0192184e-c960-4208-8d9a-7b6f38229f74/documents/FOUR_CORNER_PHOTOS-5817ceda-3641-4f8b-b963-fd11829a09bc.png',
];

// Same closed set as IntakeDocKind (src/components/sales/types.ts). Sorted
// longest-first so a prefix match can't pick a shorter kind when a longer
// one also matches (no actual collisions today, but cheap to be safe).
const KINDS = [
  'VIN_TO_DAMAGE_ALIGNMENT',
  'UNDERSIDE_BRACING_SHOTS',
  'FOUR_CORNER_PHOTOS',
  'LINE_BOARD_SWEEP',
  'INSURANCE_CARD',
  'PRIOR_ESTIMATE',
  'DAMAGE_PHOTO',
  'WALKAROUND',
  'DL_FRONT',
  'DL_BACK',
].sort((a, b) => b.length - a.length);

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function parseKind(filename) {
  for (const kind of KINDS) {
    if (new RegExp(`^${kind}-${UUID_RE}\\.[A-Za-z0-9]+$`).test(filename)) return kind;
  }
  return null;
}

/** {org}/leads/{lead_id}/documents/{filename} — the pre-lead_vehicles path
 *  shape this script targets. Anything else doesn't match. */
function parseLegacyPath(path) {
  const parts = path.split('/');
  if (parts.length !== 5 || parts[1] !== 'leads' || parts[3] !== 'documents') return null;
  const [org, , leadId, , filename] = parts;
  return { org, leadId, filename };
}

/** Mirrors sales-db.ts's ensurePrimaryLeadVehicle: insert; on conflict
 *  (unique-violation from lead_vehicles_primary_unique), select the row
 *  that already exists. In report mode, only ever selects — never inserts —
 *  and reports what it WOULD create instead. */
async function resolvePrimaryLeadVehicle(lead, apply) {
  const { data: existing, error: selErr } = await supabase
    .from('lead_vehicles')
    .select('id')
    .eq('lead_id', lead.id)
    .eq('is_primary', true)
    .maybeSingle();
  if (selErr) throw new Error(`lead_vehicles lookup failed for ${lead.id}: ${selErr.message}`);
  if (existing) return { id: existing.id, created: false };
  if (!apply) return { id: null, created: true };

  const { data: inserted, error: insErr } = await supabase
    .from('lead_vehicles')
    .insert({
      lead_id: lead.id,
      vehicle_year: lead.vehicle_year ?? null,
      vehicle_make: lead.vehicle_make ?? null,
      vehicle_model: lead.vehicle_model ?? null,
      vin: lead.vin_last8 ?? null,
      is_primary: true,
    })
    .select('id')
    .single();
  if (!insErr) return { id: inserted.id, created: true };

  const { data: retryExisting } = await supabase
    .from('lead_vehicles')
    .select('id')
    .eq('lead_id', lead.id)
    .eq('is_primary', true)
    .maybeSingle();
  if (retryExisting) return { id: retryExisting.id, created: false };
  throw new Error(`lead_vehicles insert failed for ${lead.id}: ${insErr.message}`);
}

async function resolveOne(path) {
  const parsed = parseLegacyPath(path);
  if (!parsed) {
    return { path, ok: false, reason: 'Path does not match {org}/leads/{lead_id}/documents/{filename} shape.' };
  }
  const { org, leadId, filename } = parsed;

  const kind = parseKind(filename);
  if (!kind) {
    return { path, ok: false, reason: `Could not parse a known IntakeDocKind from filename "${filename}".` };
  }

  const { data: lead, error: leadErr } = await supabase
    .from('intake_leads')
    .select('id, organization_id, customer_name, vehicle_year, vehicle_make, vehicle_model, vin_last8, documents')
    .eq('id', leadId)
    .maybeSingle();
  if (leadErr) return { path, ok: false, reason: `Lead lookup failed: ${leadErr.message}` };
  if (!lead) return { path, ok: false, reason: `No intake_leads row for id "${leadId}".` };
  if (lead.organization_id !== org) {
    return {
      path,
      ok: false,
      reason: `Path org segment (${org}) doesn't match lead ${leadId}'s organization_id (${lead.organization_id}).`,
    };
  }

  const folder = path.split('/').slice(0, -1).join('/');
  const { data: listing, error: listErr } = await supabase.storage.from(BUCKET).list(folder, { search: filename });
  const object = listing?.find((f) => f.name === filename);
  if (listErr || !object) {
    return {
      path,
      ok: false,
      reason: `Storage object not found at list time: ${listErr?.message ?? 'no matching entry'}.`,
    };
  }
  const byteSize = object.metadata?.size ?? null;
  const mimeType = object.metadata?.mimetype ?? null;
  const notes = [];
  if (byteSize == null) notes.push('Storage metadata had no size.');
  if (mimeType == null) notes.push('Storage metadata had no mimetype.');

  const legacyDocs = Array.isArray(lead.documents) ? lead.documents : [];
  const legacyEntry = legacyDocs.find((d) => d && d.storagePath === path);
  const fileName = legacyEntry?.fileName ?? filename;
  if (!legacyEntry) {
    notes.push('No matching intake_leads.documents entry — used the storage-generated filename as file_name.');
  } else if (legacyEntry.kind !== kind) {
    notes.push(
      `intake_leads.documents recorded kind "${legacyEntry.kind}", filename-derived kind is "${kind}" — used the filename-derived kind.`,
    );
  }

  const { data: existingDoc, error: existingErr } = await supabase
    .from('vehicle_documents')
    .select('id')
    .eq('storage_path', path)
    .maybeSingle();
  if (existingErr) return { path, ok: false, reason: `vehicle_documents lookup failed: ${existingErr.message}` };
  if (existingDoc) {
    return {
      path,
      ok: false,
      alreadyDone: true,
      reason: `Already backfilled — vehicle_documents row ${existingDoc.id} already references this path.`,
    };
  }

  const leadVehicle = await resolvePrimaryLeadVehicle(lead, APPLY);

  return {
    path,
    ok: true,
    notes,
    row: {
      id: randomUUID(),
      organization_id: lead.organization_id,
      lead_vehicle_id: leadVehicle.id, // null in report mode when it would be newly created
      kind,
      file_name: fileName,
      storage_path: path,
      byte_size: byteSize,
      mime_type: mimeType,
    },
    leadVehicleCreated: leadVehicle.created,
    customerName: lead.customer_name,
  };
}

async function main() {
  console.log(
    APPLY
      ? 'APPLY MODE — the writes below will be made.\n'
      : 'REPORT MODE — no writes will be made. Re-run with --apply to write.\n',
  );

  const results = [];
  for (const path of OBJECT_PATHS) {
    results.push(await resolveOne(path));
  }

  const resolved = results.filter((r) => r.ok);
  const skipped = results.filter((r) => !r.ok);

  for (const r of resolved) {
    console.log(`✓ ${r.path}`);
    console.log(`  lead: ${r.customerName}`);
    console.log(
      `  lead_vehicle_id: ${r.row.lead_vehicle_id ?? '(would be created — none exists yet)'}${
        r.leadVehicleCreated ? ' [new primary row]' : ' [existing primary row]'
      }`,
    );
    console.log('  vehicle_documents row to insert:');
    console.log(
      `    ${JSON.stringify(
        { ...r.row, lead_vehicle_id: r.row.lead_vehicle_id ?? '<pending>' },
        null,
        2,
      ).replace(/\n/g, '\n    ')}`,
    );
    for (const note of r.notes) console.log(`  note: ${note}`);
    console.log('');
  }

  if (skipped.length > 0) {
    console.log('Not resolved — nothing written or deleted for these:\n');
    for (const r of skipped) {
      console.log(`✗ ${r.path}`);
      console.log(`  ${r.reason}`);
      console.log('');
    }
  }

  console.log(`${resolved.length} resolved, ${skipped.length} skipped, out of ${OBJECT_PATHS.length} total.`);

  if (!APPLY) {
    console.log('\nReport only — nothing was written. Re-run with --apply to perform the inserts above.');
    return;
  }

  console.log('\nApplying...\n');
  for (const r of resolved) {
    const { error } = await supabase.from('vehicle_documents').insert(r.row);
    if (error) {
      console.error(`✗ insert failed for ${r.path}: ${error.message}`);
      continue;
    }
    console.log(`✓ inserted vehicle_documents row ${r.row.id} for ${r.path}`);
  }
}

await main();
