/**
 * MESH Platform — shared base64 image helpers for vision/OCR routes.
 */

export const ALLOWED_IMAGE_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

/** Strips an optional `data:<mime>;base64,` prefix and returns { data, mime }. */
export function parseDataUrl(
  input: string,
  fallbackMime: string,
): { data: string; mime: string } {
  const trimmed = input.trim();
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(trimmed);
  if (match) {
    return { mime: match[1], data: match[2] };
  }
  return { data: trimmed, mime: fallbackMime };
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function isLikelyBase64(s: string): boolean {
  const clean = s.replace(/\s/g, '');
  return clean.length > 0 && clean.length % 4 === 0 && BASE64_RE.test(clean);
}

/** Clamps a value into the inclusive [0, 1] range; non-finite -> 0. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

const HTTP_URL_RE = /^https?:\/\//i;
/** 15 MB ceiling on fetched images. */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export function isHttpUrl(s: string): boolean {
  return HTTP_URL_RE.test(s.trim());
}

export class ImageResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageResolveError';
  }
}

/**
 * Resolves an image input (either an http(s) URL or raw/data-URL base64) into
 * `{ data, mime }` base64 bytes suitable for a Gemini inlineData part.
 *
 * @throws {ImageResolveError} on fetch failure, oversize payload, or invalid base64.
 */
export async function resolveImageInput(
  input: string,
  fallbackMime: string,
): Promise<{ data: string; mime: string }> {
  const trimmed = input.trim();

  if (isHttpUrl(trimmed)) {
    let res: Response;
    try {
      res = await fetch(trimmed);
    } catch (err) {
      throw new ImageResolveError(
        err instanceof Error ? `Failed to fetch image: ${err.message}` : 'Failed to fetch image.',
      );
    }
    if (!res.ok) {
      throw new ImageResolveError(`Image fetch returned HTTP ${res.status}.`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) {
      throw new ImageResolveError('Fetched image was empty.');
    }
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      throw new ImageResolveError('Fetched image exceeds the 15 MB limit.');
    }

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    const mime = ALLOWED_IMAGE_MIME.has(contentType) ? contentType : fallbackMime;
    return { data: buf.toString('base64'), mime };
  }

  const { data, mime } = parseDataUrl(trimmed, fallbackMime);
  if (!isLikelyBase64(data)) {
    throw new ImageResolveError('Image is not valid base64 data.');
  }
  return { data, mime };
}
