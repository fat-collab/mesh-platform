/**
 * MESH Sales — Remote AOB Secure Signing Link data access.
 *
 * Backs the off-site policyholder signing flow: when the person at intake
 * isn't the Named Insured (Policyholder Match = No), a tokenized link is
 * dispatched that a proxy can open unauthenticated to review the AOB
 * agreement and sign. DB-first with a session-local fallback, mirroring
 * every other DAL in this app — usable from both client components and the
 * server API route that creates/dispatches the link (the same pattern
 * convertLeadToRO already uses from within an API route).
 */
import { getSupabaseBrowserClient } from './supabase';
import type { ProxyPolicyholder } from '@/components/sales/types';

const TABLE = 'remote_aob_links';

export type RemoteAobLinkStatus = 'PENDING' | 'SIGNED' | 'EXPIRED';

export interface RemoteAobLinkRecord {
  token: string;
  leadId: string;
  proxy: ProxyPolicyholder;
  status: RemoteAobLinkStatus;
  signatureUrl: string | null;
  createdAt: string;
  signedAt: string | null;
}

interface LinkRow {
  token: string;
  lead_id: string;
  proxy_full_name: string;
  proxy_relationship: string | null;
  proxy_phone: string | null;
  proxy_email: string | null;
  status: RemoteAobLinkStatus;
  signature_url: string | null;
  created_at: string;
  signed_at: string | null;
}

function rowToRecord(row: LinkRow): RemoteAobLinkRecord {
  return {
    token: row.token,
    leadId: row.lead_id,
    proxy: {
      fullName: row.proxy_full_name,
      relationship: row.proxy_relationship ?? '',
      phone: row.proxy_phone ?? '',
      email: row.proxy_email ?? '',
    },
    status: row.status,
    signatureUrl: row.signature_url,
    createdAt: row.created_at,
    signedAt: row.signed_at,
  };
}

function genToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now()}${Math.round(Math.random() * 1e9)}`;
}

// Session-local fallback store (keyed by token) — when the table is
// unavailable, the link still works within the current process/session.
const localLinks = new Map<string, RemoteAobLinkRecord>();

/** Creates a pending remote-AOB link for a lead + proxy policyholder. */
export async function createRemoteAobLink(
  leadId: string,
  proxy: ProxyPolicyholder,
): Promise<{ token: string }> {
  const token = genToken();
  const now = new Date().toISOString();

  try {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from(TABLE).insert({
      token,
      lead_id: leadId,
      proxy_full_name: proxy.fullName,
      proxy_relationship: proxy.relationship || null,
      proxy_phone: proxy.phone || null,
      proxy_email: proxy.email || null,
      status: 'PENDING',
    });
    if (!error) return { token };
  } catch {
    /* fall through to local */
  }

  localLinks.set(token, {
    token,
    leadId,
    proxy,
    status: 'PENDING',
    signatureUrl: null,
    createdAt: now,
    signedAt: null,
  });
  return { token };
}

/** Loads a remote-AOB link by token (DB first, else local). */
export async function getRemoteAobLink(token: string): Promise<RemoteAobLinkRecord | null> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (!error && data) return rowToRecord(data as unknown as LinkRow);
  } catch {
    /* fall through to local */
  }
  return localLinks.get(token) ?? null;
}

/**
 * Marks a remote-AOB link SIGNED with the captured signature. Returns the
 * associated leadId so the caller can advance the lead's LeadStatus — kept
 * separate from this DAL; sales-db.ts owns the AOB_SIGNED business rule
 * (auto-converting the lead into a Repair Order).
 *
 * Status-guarded: the update only matches a row still PENDING
 * (`.eq('status', 'PENDING')`), so a second call against an already-SIGNED
 * token — a double-tap, a replay, a re-render mid-flight — cannot overwrite
 * the original signature/signed_at. Returns null in that case, same as "not
 * found," which is exactly how the caller should treat it: there is nothing
 * new to advance.
 *
 * Still two separate writes (this table, then intake_leads via the caller)
 * — see the API route that wraps this for the actual atomicity fix; that
 * route, not this function, is the strongly-consistent entry point.
 */
export async function signRemoteAobLink(
  token: string,
  signatureDataUrl: string,
): Promise<{ leadId: string } | null> {
  const now = new Date().toISOString();

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(TABLE)
      .update({ status: 'SIGNED', signature_url: signatureDataUrl, signed_at: now })
      .eq('token', token)
      .eq('status', 'PENDING')
      .select('lead_id')
      .maybeSingle();
    if (!error && data) return { leadId: (data as { lead_id: string }).lead_id };
    if (!error && !data) return null; // already signed, expired, or unknown token
  } catch {
    /* fall through to local */
  }

  const local = localLinks.get(token);
  if (!local || local.status !== 'PENDING') return null;
  local.status = 'SIGNED';
  local.signatureUrl = signatureDataUrl;
  local.signedAt = now;
  return { leadId: local.leadId };
}
