/**
 * POST /api/v1/vision/ocr
 *
 * Document OCR for Stage 1 intake (VIN plates & insurance cards). Accepts
 * multipart form data and returns structured extracted fields via the
 * abstracted vision service (Gemini, with deterministic mock fallback).
 *
 * Request (multipart/form-data):
 *   file:    the image file (required)
 *   docType: 'VIN' | 'INSURANCE' (required)
 *
 * Response 200:
 *   { success: boolean, data: {...fields}, rawText?: string, provider?: string }
 */
import { NextResponse } from 'next/server';
import { visionService, type DocType } from '@/lib/vision/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  const file = form.get('file');
  const docTypeRaw = String(form.get('docType') ?? '').toUpperCase();

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Field "file" is required.' }, { status: 400 });
  }
  const ALLOWED: DocType[] = [
    'VIN',
    'INSURANCE',
    'SUPPLEMENT_EVIDENCE',
    'PDR_DENT_GRID',
    'TOTAL_LOSS_COMP_SHEET',
  ];
  if (!ALLOWED.includes(docTypeRaw as DocType)) {
    return NextResponse.json(
      { error: `Field "docType" must be one of: ${ALLOWED.join(', ')}.` },
      { status: 400 },
    );
  }

  const result = await visionService.extractDocument(file, docTypeRaw as DocType);
  return NextResponse.json(result);
}
