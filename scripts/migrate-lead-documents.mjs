/**
 * MESH — one-off Storage migration for the two intake_leads rows whose
 * `documents` column held inline base64 images (root cause of the
 * /dashboard/sales statement-timeout incident — see supabase/migrations/
 * 20260806000000_documents_storage_bucket.sql for the investigation).
 *
 * For each row below: decodes every documents[] entry's base64 data URL,
 * uploads the decoded bytes to the 'documents' bucket under
 * {organization_id}/leads/{lead_id}/documents/{kind}-{uuid}.{ext}, then
 * replaces that entry's `url` field with `storagePath` holding the new
 * object path. No base64 is left in the row afterward.
 *
 * Also writes a local JSON snapshot of each row's original `documents`
 * value to the scratchpad before touching anything, as a second, redundant
 * backup alongside the DB-level backup already taken separately.
 *
 * Preconditions:
 *   - 20260806000000_documents_storage_bucket.sql is applied (bucket must
 *     exist) — confirmed live.
 *   - A DB-level backup of both rows has been taken — confirmed done.
 *
 * Idempotent: an entry that already has `storagePath` (no `url`) is left
 * as-is, so re-running after a partial failure only retries what's left.
 *
 * Run:
 *   node --env-file=.env.local scripts/migrate-lead-documents.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Not SUPABASE_SERVICE_ROLE_KEY: legacy service_role JWTs are disabled on
// this project (confirmed live — "Legacy API keys are disabled" on first
// use). SUPABASE_SECRET_KEY is the new-style key createSupabaseServerClient()
// (src/lib/supabase-server.ts) already uses for the same privileged-write
// purpose.
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;

if (!URL || !SERVICE_KEY || SERVICE_KEY.includes('your_')) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or a real SUPABASE_SECRET_KEY in .env.local.');
  process.exit(1);
}

const supabase = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKET = 'documents';
const BACKUP_DIR = '/private/tmp/claude-501/-Users-youngmanfran-mesh-platform/db6415a6-7ce1-446c-a213-22782b516a32/scratchpad';

const LEAD_IDS = [
  'lead-89fda7ed-f801-4ed1-a585-9df6ad89a810', // Pamela Anderson, 22.6MB
  'lead-0192184e-c960-4208-8d9a-7b6f38229f74', // Michael Jordan, 6.4MB
];

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error(`Not a base64 data URL (starts with: ${dataUrl.slice(0, 30)}...)`);
  }
  const [, mime, b64] = match;
  return { mime, buffer: Buffer.from(b64, 'base64') };
}

async function migrateLead(leadId) {
  const { data: lead, error: fetchErr } = await supabase
    .from('intake_leads')
    .select('id, organization_id, customer_name, documents')
    .eq('id', leadId)
    .maybeSingle();
  if (fetchErr) throw new Error(`Fetch failed for ${leadId}: ${fetchErr.message}`);
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  if (!lead.organization_id) throw new Error(`Lead ${leadId} has no organization_id`);

  const docs = Array.isArray(lead.documents) ? lead.documents : [];
  console.log(`\n${lead.customer_name} (${leadId}) — ${docs.length} document(s)`);

  const backupPath = `${BACKUP_DIR}/lead-documents-backup-${leadId}.json`;
  await writeFile(
    backupPath,
    JSON.stringify({ leadId, organizationId: lead.organization_id, documents: lead.documents }, null, 2),
  );
  console.log(`  local backup written: ${backupPath}`);

  const nextDocs = [];
  for (const doc of docs) {
    if (!doc.url || doc.storagePath) {
      // Already migrated (idempotent re-run), or nothing to upload.
      nextDocs.push(doc);
      continue;
    }

    const { mime, buffer } = parseDataUrl(doc.url);
    const ext = MIME_EXT[mime] ?? 'bin';
    const path = `${lead.organization_id}/leads/${lead.id}/documents/${doc.kind}-${randomUUID()}.${ext}`;

    console.log(
      `  uploading ${doc.kind} (${doc.fileName ?? 'unnamed'}, ${(buffer.length / 1024 / 1024).toFixed(2)} MB) -> ${path}`,
    );

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: mime, upsert: false });
    if (uploadErr) throw new Error(`Upload failed for ${doc.kind} on ${leadId}: ${uploadErr.message}`);

    // Verify the object landed with the expected byte size before touching the DB row.
    const folder = path.split('/').slice(0, -1).join('/');
    const filename = path.split('/').pop();
    const { data: listing, error: listErr } = await supabase.storage
      .from(BUCKET)
      .list(folder, { search: filename });
    const uploaded = listing?.find((f) => f.name === filename);
    if (listErr || !uploaded || uploaded.metadata?.size !== buffer.length) {
      throw new Error(
        `Post-upload verification failed for ${path}: expected ${buffer.length} bytes, got ${
          uploaded?.metadata?.size ?? 'not found'
        }`,
      );
    }

    nextDocs.push({ kind: doc.kind, fileName: doc.fileName, storagePath: path });
  }

  const { error: updateErr } = await supabase.from('intake_leads').update({ documents: nextDocs }).eq('id', leadId);
  if (updateErr) throw new Error(`DB update failed for ${leadId}: ${updateErr.message}`);

  console.log(`  done — documents column now holds ${nextDocs.length} path reference(s), no inline base64.`);
}

for (const leadId of LEAD_IDS) {
  await migrateLead(leadId);
}

console.log('\nAll leads migrated.');
