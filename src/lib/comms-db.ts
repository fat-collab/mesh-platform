/**
 * MESH Ops — repair-order customer communication data access layer.
 *
 * RO-scoped comms log (one RO → many entries) backed by the repair_order_comms
 * table, with a session-local fallback. Mirrors the DB-first + fallback pattern
 * of parts-db.ts.
 */
import { getSupabaseBrowserClient } from './supabase';
import { isUuid } from './is-uuid';
import { executeDBOperation } from './db-guard';
import type {
  CommChannel,
  CommDirection,
  RepairOrderCommEntry,
} from '@/components/ops/ro-comms-types';

const TABLE = 'repair_order_comms';

interface CommRow {
  id: string;
  repair_order_id: string;
  channel: CommChannel;
  direction: CommDirection;
  recipient: string | null;
  content: string;
  sender_name: string | null;
  created_at: string;
}

function rowToEntry(row: CommRow): RepairOrderCommEntry {
  return {
    id: row.id,
    repairOrderId: row.repair_order_id,
    channel: row.channel,
    direction: row.direction,
    recipient: row.recipient ?? '',
    content: row.content,
    senderName: row.sender_name ?? '',
    createdAt: row.created_at,
  };
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `comm-${crypto.randomUUID()}`;
  }
  return `comm-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

// Session-local fallback store, keyed by repair order id. Pre-seeded for the
// default board RO ('mock-a6f1') so the drawer comms timeline is populated in
// local/fallback mode.
const localComms = new Map<string, RepairOrderCommEntry[]>([
  [
    'mock-a6f1',
    [
      {
        id: 'seed-mock-a6f1-comm-1',
        repairOrderId: 'mock-a6f1',
        channel: 'SMS',
        direction: 'OUTBOUND',
        recipient: '(512) 555-0142',
        content: 'Hi Dana — your F-150 is in teardown; we found hidden rail damage and filed a supplement.',
        senderName: 'Avery Nguyen',
        createdAt: '2026-07-25T14:10:00.000Z',
      },
      {
        id: 'seed-mock-a6f1-comm-2',
        repairOrderId: 'mock-a6f1',
        channel: 'SMS',
        direction: 'INBOUND',
        recipient: 'Shop',
        content: 'Thanks for the update — go ahead with the repair.',
        senderName: 'Dana Whitfield',
        createdAt: '2026-07-25T15:02:00.000Z',
      },
      {
        id: 'seed-mock-a6f1-comm-3',
        repairOrderId: 'mock-a6f1',
        channel: 'NOTE',
        direction: 'OUTBOUND',
        recipient: 'Internal',
        content: 'Customer approved supplement over text — proceeding to parts + PDR.',
        senderName: 'Marcus Vance',
        createdAt: '2026-07-25T15:05:00.000Z',
      },
    ],
  ],
]);

/** Loads all comm entries for a repair order (DB when available, else local). */
export async function getCommEntries(
  repairOrderId: string,
): Promise<RepairOrderCommEntry[]> {
  // A non-UUID id (sample/fallback board data) would make the query below
  // throw "invalid input syntax for type uuid" — not a real DB failure, so
  // skip the round-trip entirely and go straight to the local fallback.
  if (!isUuid(repairOrderId)) {
    return (localComms.get(repairOrderId) ?? []).map((e) => ({ ...e }));
  }
  const supabase = getSupabaseBrowserClient();
  const result = await executeDBOperation<CommRow[]>(
    'getCommEntries',
    async () => {
      const res = await supabase
        .from(TABLE)
        .select('*')
        .eq('repair_order_id', repairOrderId)
        .order('created_at', { ascending: true });
      return { data: res.data as unknown as CommRow[] | null, error: res.error };
    },
    [],
  );
  if (result.data && result.data.length > 0) {
    return result.data.map(rowToEntry);
  }
  return (localComms.get(repairOrderId) ?? []).map((e) => ({ ...e }));
}

export interface AddCommInput {
  repairOrderId: string;
  channel: CommChannel;
  direction?: CommDirection;
  recipient?: string;
  content: string;
  senderName?: string;
}

/** Logs a communication entry (DB when available, else local). */
export async function addCommEntry(entry: AddCommInput): Promise<RepairOrderCommEntry> {
  const direction: CommDirection = entry.direction ?? 'OUTBOUND';
  const recipient = entry.recipient?.trim() || '';
  const senderName = entry.senderName?.trim() || '';

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        repair_order_id: entry.repairOrderId,
        channel: entry.channel,
        direction,
        recipient: recipient || null,
        content: entry.content.trim(),
        sender_name: senderName || null,
      })
      .select('*')
      .single();
    if (!error && data) {
      return rowToEntry(data as unknown as CommRow);
    }
  } catch {
    /* fall through to local store */
  }

  const created: RepairOrderCommEntry = {
    id: genId(),
    repairOrderId: entry.repairOrderId,
    channel: entry.channel,
    direction,
    recipient,
    content: entry.content.trim(),
    senderName,
    createdAt: new Date().toISOString(),
  };
  const existing = localComms.get(entry.repairOrderId) ?? [];
  existing.push(created);
  localComms.set(entry.repairOrderId, existing);
  return created;
}
