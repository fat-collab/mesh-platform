/**
 * MESH — activity & timestamp audit ledger (server-side, persistent).
 *
 * Backed by a JSON file on disk so it is a single source of truth shared across
 * requests and processes: the Vapi webhook (server) writes entries and the
 * audit API route (server) reads them, and the dashboard fetches via that API.
 * Persists across dev reloads (stored in the OS temp dir to avoid tripping the
 * Next file watcher). Timestamps are UTC (ISO 8601).
 *
 * SERVER-ONLY — uses node:fs. Do not import this module from client components;
 * import types from ./types and read via GET /api/v1/audit/[claimId].
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AuditLogEntry } from './types';

export type { AuditChannel, AuditDirection, AuditLogEntry } from './types';

const STORE_FILE = path.join(os.tmpdir(), 'mesh-audit-ledger.json');

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `audit-${crypto.randomUUID()}`;
  }
  return `audit-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

function buildSeed(): Record<string, AuditLogEntry[]> {
  return {
    'SF-771204': [
      {
        id: 'audit-seed-1',
        timestamp: '2026-07-02T10:31:00.000Z',
        channel: 'SYSTEM',
        direction: 'OUTBOUND',
        summary: 'Supplement #1 submitted to State Farm with light-board photos.',
        status: 'submitted',
        author: 'MESH',
      },
      {
        id: 'audit-seed-2',
        timestamp: '2026-07-15T16:05:00.000Z',
        channel: 'VAPI_CALL',
        direction: 'OUTBOUND',
        summary: 'AI follow-up: left voicemail for desk adjuster re: supplement status.',
        transcript:
          'Assistant: Hi, this is the MESH Collision AI assistant calling about claim SF-771204. We submitted supplement #1 on July 2nd and are following up on its status. Please call us back at your convenience. Thank you.',
        status: 'completed',
        author: 'Vapi',
      },
    ],
    'AL-660118': [
      {
        id: 'audit-seed-3',
        timestamp: '2026-07-20T09:30:00.000Z',
        channel: 'VAPI_CALL',
        direction: 'OUTBOUND',
        summary: 'AI follow-up: adjuster confirmed supplement approved, payment pending.',
        transcript:
          'Assistant: Calling regarding claim AL-660118 supplement.\nAdjuster: Yes, that one is approved — payment is queued to the shop, should be out this week.\nAssistant: Thank you, noted.',
        status: 'completed',
        author: 'Vapi',
      },
      {
        id: 'audit-seed-4',
        timestamp: '2026-07-20T09:35:00.000Z',
        channel: 'SYSTEM',
        direction: 'OUTBOUND',
        summary: 'Supplement moved to APPROVED_PENDING_PAYMENT.',
        status: 'approved',
        author: 'MESH',
      },
    ],
  };
}

function load(): Record<string, AuditLogEntry[]> {
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, AuditLogEntry[]>;
    }
  } catch {
    /* missing / corrupt — seed below */
  }
  const seed = buildSeed();
  save(seed);
  return seed;
}

function save(data: Record<string, AuditLogEntry[]>): void {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(data), 'utf8');
  } catch {
    /* best-effort; a failed write just means this entry isn't durable */
  }
}

/** Appends an entry to a record's audit log (id + UTC timestamp auto-filled). */
export function appendAuditEntry(
  recordId: string,
  entry: Omit<AuditLogEntry, 'id' | 'timestamp'> & { timestamp?: string },
): AuditLogEntry {
  const store = load();
  const full: AuditLogEntry = {
    id: genId(),
    timestamp: entry.timestamp ?? new Date().toISOString(),
    channel: entry.channel,
    direction: entry.direction,
    summary: entry.summary,
    transcript: entry.transcript,
    status: entry.status,
    author: entry.author,
  };
  if (!store[recordId]) store[recordId] = [];
  store[recordId].push(full);
  save(store);
  return full;
}

/** Returns a record's audit log, most recent first. */
export function getAuditLog(recordId: string): AuditLogEntry[] {
  const store = load();
  return [...(store[recordId] ?? [])].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}
