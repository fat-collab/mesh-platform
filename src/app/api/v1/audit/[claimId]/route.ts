/**
 * GET /api/v1/audit/[claimId]
 *
 * Returns all timestamped audit entries for a record. The param accepts either
 * a claim number or a supplement/RO id (the same key used when appending).
 *
 * Response 200: { claimId: string, entries: AuditLogEntry[] }
 */
import { NextResponse } from 'next/server';
import { getAuditLog } from '@/lib/audit/ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ claimId: string }> },
): Promise<Response> {
  const { claimId } = await params;
  const id = decodeURIComponent(claimId);
  return NextResponse.json({ claimId: id, entries: getAuditLog(id) });
}
