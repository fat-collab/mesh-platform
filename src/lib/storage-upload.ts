/**
 * MESH — shared 'documents' Storage bucket helpers.
 *
 * The one place compression, extension/MIME resolution, and the actual
 * Storage PUT happen — every writer of a document reference
 * (vehicle_documents, rental_loan_drivers' driver license/insurance photos,
 * parts_line_items.invoice_url, remote_aob_links.signature_url) funnels
 * through this instead of hand-rolling its own upload + path logic, so a
 * change here (compression tuning, a new allowed MIME type) doesn't need to
 * be repeated per caller.
 */
import { getSupabaseBrowserClient, type MeshSupabaseClient } from './supabase';

/** Minimal shape every caller's Supabase client needs to satisfy — just the
 *  Storage API, not the full client. Storage isn't parameterized by the
 *  Database generic, so this is satisfied identically by the browser client
 *  (getSupabaseBrowserClient) and a service-role server client
 *  (createSupabaseServerClient) alike. Callers pass their own client rather
 *  than this module resolving one internally, so a server route can use its
 *  service-role client without ever touching browser session state. */
type StorageCapableClient = { storage: MeshSupabaseClient['storage'] };

export const DOCUMENTS_BUCKET = 'documents';

export const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

const COMPRESS_MAX_DIMENSION = 2000;
const COMPRESS_QUALITY = 0.8;

/**
 * A bare, RFC4122 v4-shaped id — for any id inserted as the `id` of a table
 * with a native `uuid` primary key, or embedded in a Storage object path for
 * uniqueness.
 */
export function genUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Downscales + re-encodes an image File before it ever reaches Storage — a
 * driver's license photo landed at 12MB uncompressed; twenty hail-panel
 * shots at that size is a gigabyte per vehicle, over cellular. Resizes to a
 * ~2000px long edge (never upscales) and always re-encodes as JPEG at 80%
 * quality, so a large lossless PNG screenshot benefits even when it's
 * already under the size cap. Non-image files (e.g. PRIOR_ESTIMATE's
 * json/xml/csv/txt/pdf) pass through untouched — running them through
 * canvas would corrupt them. HEIC decode support is inconsistent outside
 * Safari; any decode/encode failure falls back to uploading the original
 * file rather than failing the upload — the bucket's 15MB hard limit is the
 * real backstop either way.
 */
export async function compressImageFile(file: File): Promise<File> {
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
    console.warn(`[storage-upload] image compression failed for ${file.name}, uploading original:`, err);
    return file;
  } finally {
    bitmap?.close();
  }
}

/**
 * Guards against ever persisting a URL that's already dead by the time it's
 * read back. blob: URLs never leave the browser tab that created them;
 * data: URLs reintroduce the "megabytes inline in a DB column" problem the
 * 'documents' bucket migration exists to fix. Every function that writes a
 * document URL/path column calls this immediately before its insert/update
 * — closes the class of bug at the write site, rather than relying on a
 * reader to notice a dead reference later. Throws (doesn't return a bool)
 * because a caller reaching this with an ephemeral URL is always a bug in
 * the caller, not a recoverable runtime condition.
 */
export function assertPersistableDocumentUrl(value: string | null | undefined): void {
  if (!value) return;
  const scheme = value.startsWith('blob:') ? 'blob:' : value.startsWith('data:') ? 'data:' : null;
  if (scheme) {
    throw new Error(
      `Refusing to persist a ${scheme} URL as a document reference — it will not resolve outside the tab that created it.`,
    );
  }
}

// 15 minutes — long enough for a rep to view/download while a drawer or
// modal is open, short enough that a leaked URL doesn't stay valid.
const SIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * Batched signed-URL minting for the private 'documents' bucket — one
 * createSignedUrls call for many paths, never one call per file. Call this
 * lazily at render time for exactly what's being displayed right now — never
 * from a list/board query (getLeads and friends) — since every URL costs a
 * live Storage round trip and expires in 15 minutes regardless of whether
 * anyone ever looks at it.
 *
 * Path shape is irrelevant here — createSignedUrls is a pure path → URL
 * lookup against the bucket's actual object keys, with no assumptions about
 * path structure. Both current uploads
 * ({org}/leads/{lead}/vehicles/{vehicle}/documents/...) and the handful of
 * legacy paths without a /vehicles/ segment sign identically; nothing about
 * this function needs to special-case either shape.
 *
 * Best-effort per path, not just per batch: createSignedUrls already
 * returns one result per input with its own path/error, so one bad path
 * (deleted object, bad RLS) just doesn't get an entry in the returned map
 * rather than failing every other path in the same call. A total failure
 * (network, bucket gone) returns an empty map rather than throwing —
 * callers treat a missing entry as "no preview available," never a crash.
 */
export async function getSignedDocumentUrls(paths: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter((p): p is string => Boolean(p))));
  if (unique.length === 0) return result;

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      console.warn('[storage-upload] createSignedUrls failed:', error?.message);
      return result;
    }
    for (const item of data) {
      if (item.path && item.signedUrl && !item.error) {
        result.set(item.path, item.signedUrl);
      } else {
        console.warn(`[storage-upload] failed to sign ${item.path ?? '(unknown path)'}:`, item.error);
      }
    }
  } catch (err) {
    console.warn('[storage-upload] getSignedDocumentUrls failed:', err);
  }
  return result;
}

/**
 * The one place every caller actually PUTs bytes into the 'documents'
 * bucket — uploadDocumentFile (compressed Files, browser client) and
 * uploadDocumentBlob (raw blobs, any client) both funnel through this.
 * Never throws — returns false and logs on failure.
 */
async function putDocumentBytes(
  client: StorageCapableClient,
  path: string,
  body: File | Blob | Buffer,
  contentType: string | undefined,
): Promise<boolean> {
  try {
    const { error } = await client.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, body, { contentType, upsert: false });
    if (error) {
      console.warn(`[storage-upload] Storage upload failed for ${path}:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[storage-upload] putDocumentBytes failed for ${path}:`, err);
    return false;
  }
}

/**
 * Compresses (if an image) and uploads a file to the 'documents' Storage
 * bucket at `${pathWithoutExt}.${ext}` (extension resolved from the
 * possibly-recompressed file's MIME type), returning the resulting path and
 * the final File (for callers that also need its post-compression
 * name/size/type). Never throws — returns null and logs on any failure, so
 * a failed upload never fails whatever the caller is attaching it to.
 *
 * Browser-only (compressImageFile uses canvas/createImageBitmap) — always
 * uploads via the browser client. For a server-side upload with no DOM
 * available, or a small blob that doesn't need compression (a signature),
 * use uploadDocumentBlob instead.
 */
export async function uploadDocumentFile(
  pathWithoutExt: string,
  file: File,
): Promise<{ path: string; file: File } | null> {
  try {
    const uploadFile = await compressImageFile(file);
    const ext = MIME_EXT[uploadFile.type] ?? (uploadFile.name.split('.').pop() || 'bin');
    const path = `${pathWithoutExt}.${ext}`;

    const ok = await putDocumentBytes(getSupabaseBrowserClient(), path, uploadFile, uploadFile.type || undefined);
    if (!ok) return null;

    return { path, file: uploadFile };
  } catch (err) {
    console.warn(`[storage-upload] uploadDocumentFile failed for ${pathWithoutExt}:`, err);
    return null;
  }
}

/**
 * Uploads a raw blob/buffer to the 'documents' bucket with no compression
 * step — for small, already-final content like a signature PNG, where
 * running it through compressImageFile's canvas pipeline would be both
 * unnecessary and (server-side) impossible, since there's no DOM. Takes the
 * caller's own client explicitly (see StorageCapableClient) so a
 * service-role server route can upload without ever touching browser
 * session state. Returns the resulting path, or null on failure — never
 * throws.
 */
export async function uploadDocumentBlob(
  client: StorageCapableClient,
  pathWithoutExt: string,
  body: Blob | Buffer,
  contentType: string,
): Promise<string | null> {
  const ext = MIME_EXT[contentType] ?? 'bin';
  const path = `${pathWithoutExt}.${ext}`;
  const ok = await putDocumentBytes(client, path, body, contentType);
  return ok ? path : null;
}
