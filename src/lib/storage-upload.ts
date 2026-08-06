/**
 * MESH — shared 'documents' Storage bucket helpers.
 *
 * The one place compression, extension/MIME resolution, and the actual
 * Storage PUT happen — every writer of a document reference (vehicle_documents
 * today; rental_loan_drivers' driver license/insurance photos; remote-AOB
 * signatures and parts_line_items.invoice_url are coming) funnels through
 * this instead of hand-rolling its own upload + path logic, so a change here
 * (compression tuning, a new allowed MIME type) doesn't need to be repeated
 * per caller.
 */
import { getSupabaseBrowserClient } from './supabase';

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

/**
 * Compresses (if an image) and uploads a file to the 'documents' Storage
 * bucket at `${pathWithoutExt}.${ext}` (extension resolved from the
 * possibly-recompressed file's MIME type), returning the resulting path and
 * the final File (for callers that also need its post-compression
 * name/size/type). Never throws — returns null and logs on any failure, so
 * a failed upload never fails whatever the caller is attaching it to.
 */
export async function uploadDocumentFile(
  pathWithoutExt: string,
  file: File,
): Promise<{ path: string; file: File } | null> {
  try {
    const uploadFile = await compressImageFile(file);
    const ext = MIME_EXT[uploadFile.type] ?? (uploadFile.name.split('.').pop() || 'bin');
    const path = `${pathWithoutExt}.${ext}`;

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, uploadFile, { contentType: uploadFile.type || undefined, upsert: false });
    if (error) {
      console.warn(`[storage-upload] Storage upload failed for ${path}:`, error.message);
      return null;
    }

    return { path, file: uploadFile };
  } catch (err) {
    console.warn(`[storage-upload] uploadDocumentFile failed for ${pathWithoutExt}:`, err);
    return null;
  }
}
