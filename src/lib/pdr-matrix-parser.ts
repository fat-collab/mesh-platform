/**
 * MESH — PDR technician matrix import (CSV/JSON) + regional default baseline.
 *
 * Mirrors estimate-parser.ts's dispatch pattern (auto-detect JSON vs CSV,
 * defensive/best-effort — unparseable input returns []). Used by
 * ShopIntakeForm's PDR matrix dropzone; the regional baseline is the fallback
 * a shop gets if it never uploads or manually enters a matrix.
 */
import type { PdrMatrixRow } from '@/components/onboarding/types';

type MatrixRates = Omit<PdrMatrixRow, 'id' | 'technician'>;

// --- regional default baseline ----------------------------------------------

/** Illustrative flat per-technician matrix rates ($) by broad US region. */
export const REGIONAL_PDR_BASELINE: Record<string, MatrixRates> = {
  WEST: { dime: 65, nickel: 85, quarter: 115, halfDollar: 155 },
  MIDWEST: { dime: 55, nickel: 72, quarter: 98, halfDollar: 130 },
  SOUTH: { dime: 50, nickel: 68, quarter: 92, halfDollar: 122 },
  NORTHEAST: { dime: 70, nickel: 92, quarter: 124, halfDollar: 168 },
  DEFAULT: { dime: 58, nickel: 76, quarter: 102, halfDollar: 136 },
};

const STATE_TO_REGION: Record<string, keyof typeof REGIONAL_PDR_BASELINE> = {
  WA: 'WEST', OR: 'WEST', CA: 'WEST', NV: 'WEST', AZ: 'WEST', UT: 'WEST',
  ID: 'WEST', MT: 'WEST', WY: 'WEST', CO: 'WEST', NM: 'WEST', AK: 'WEST', HI: 'WEST',
  ND: 'MIDWEST', SD: 'MIDWEST', NE: 'MIDWEST', KS: 'MIDWEST', MN: 'MIDWEST',
  IA: 'MIDWEST', MO: 'MIDWEST', WI: 'MIDWEST', IL: 'MIDWEST', IN: 'MIDWEST',
  MI: 'MIDWEST', OH: 'MIDWEST',
  TX: 'SOUTH', OK: 'SOUTH', AR: 'SOUTH', LA: 'SOUTH', MS: 'SOUTH', AL: 'SOUTH',
  TN: 'SOUTH', KY: 'SOUTH', GA: 'SOUTH', FL: 'SOUTH', SC: 'SOUTH', NC: 'SOUTH',
  VA: 'SOUTH', WV: 'SOUTH',
  ME: 'NORTHEAST', NH: 'NORTHEAST', VT: 'NORTHEAST', MA: 'NORTHEAST',
  RI: 'NORTHEAST', CT: 'NORTHEAST', NY: 'NORTHEAST', NJ: 'NORTHEAST',
  PA: 'NORTHEAST', DE: 'NORTHEAST', MD: 'NORTHEAST', DC: 'NORTHEAST',
};

/** Resolves the regional default matrix rates for a 2-letter state code. */
export function getRegionalPdrBaseline(stateCode?: string): MatrixRates {
  const region = STATE_TO_REGION[(stateCode ?? '').trim().toUpperCase()];
  return REGIONAL_PDR_BASELINE[region ?? 'DEFAULT'];
}

// --- import parsing ----------------------------------------------------------

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `pdr-${crypto.randomUUID()}`;
  }
  return `pdr-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

function num(value: unknown): number {
  if (value == null || value === '') return 0;
  const n = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** First present, non-empty value among the candidate keys (case-insensitive). */
function pick(record: Record<string, unknown>, keys: string[]): unknown {
  const lower = new Map(Object.keys(record).map((k) => [k.toLowerCase(), k]));
  for (const key of keys) {
    const actual = lower.get(key.toLowerCase());
    if (actual && record[actual] != null && record[actual] !== '') return record[actual];
  }
  return undefined;
}

function normalizeRow(record: Record<string, unknown>): PdrMatrixRow | null {
  const technician = String(pick(record, ['technician', 'name', 'tech']) ?? '').trim();
  if (!technician) return null;
  return {
    id: genId(),
    technician,
    dime: num(pick(record, ['dime'])),
    nickel: num(pick(record, ['nickel'])),
    quarter: num(pick(record, ['quarter'])),
    halfDollar: num(pick(record, ['halfDollar', 'half_dollar', 'half$', 'halfdollar', 'half'])),
  };
}

function splitDelimited(line: string, delimiter: string): string[] {
  return line.split(delimiter).map((f) => f.trim());
}

function parsePdrCsv(input: string): PdrMatrixRow[] {
  const lines = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const rows = lines.map((l) => splitDelimited(l, delimiter));

  const header = rows[0].map((c) => c.toLowerCase());
  const hasHeader = header.some((h) => /tech|name/.test(h)) && !/^\d+$/.test(rows[0][0] ?? '');

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const cols = hasHeader
    ? {
        technician: header.findIndex((h) => /tech|name/.test(h)),
        dime: header.findIndex((h) => h.includes('dime')),
        nickel: header.findIndex((h) => h.includes('nickel')),
        quarter: header.findIndex((h) => h.includes('quarter')),
        halfDollar: header.findIndex((h) => h.includes('half')),
      }
    : { technician: 0, dime: 1, nickel: 2, quarter: 3, halfDollar: 4 };

  const at = (row: string[], i: number) => (i >= 0 ? row[i] : undefined);
  const out: PdrMatrixRow[] = [];
  for (const row of dataRows) {
    const normalized = normalizeRow({
      technician: at(row, cols.technician),
      dime: at(row, cols.dime),
      nickel: at(row, cols.nickel),
      quarter: at(row, cols.quarter),
      halfDollar: at(row, cols.halfDollar),
    });
    if (normalized) out.push(normalized);
  }
  return out;
}

function parsePdrJson(input: string): PdrMatrixRow[] {
  const parsed: unknown = JSON.parse(input);
  const list = Array.isArray(parsed) ? parsed : (parsed as { rows?: unknown[] })?.rows ?? [];
  if (!Array.isArray(list)) return [];
  const out: PdrMatrixRow[] = [];
  for (const item of list) {
    if (item && typeof item === 'object') {
      const normalized = normalizeRow(item as Record<string, unknown>);
      if (normalized) out.push(normalized);
    }
  }
  return out;
}

/** Parses an uploaded PDR matrix file (auto-detects JSON vs CSV). Defensive: unparseable input returns []. */
export function parsePdrMatrixFile(input: string): PdrMatrixRow[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  try {
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return parsePdrJson(trimmed);
    }
  } catch {
    /* fall through to CSV */
  }
  try {
    return parsePdrCsv(trimmed);
  } catch {
    return [];
  }
}
