/**
 * MESH — audit ledger types (framework-agnostic, safe to import anywhere).
 *
 * The runtime store lives in ./ledger (server-only, filesystem-backed). Client
 * code imports these types and reads entries via GET /api/v1/audit/[claimId].
 */

export type AuditChannel = 'VAPI_CALL' | 'SMS' | 'EMAIL' | 'SYSTEM';
export type AuditDirection = 'OUTBOUND' | 'INBOUND';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  channel: AuditChannel;
  direction: AuditDirection;
  summary: string;
  transcript?: string;
  status: string;
  author?: string;
}
