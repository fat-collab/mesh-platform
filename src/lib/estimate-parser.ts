/**
 * MESH Ops — estimate import parser.
 *
 * Parses collision-estimate line items from CIECA BMS / EMS exports (JSON or
 * XML) and raw CSV/tab/text pastes out of CCC ONE, Mitchell, or Audatex, into
 * the app's PartsLineItem shape. Best-effort and defensive: unrecognized input
 * returns [] so callers can fall back to seedDemoEstimateParts().
 */
import type { PartSourcingTier, PartsLineItem } from '@/components/ops/types';

// --- field inference --------------------------------------------------------

/** Infers sourcing tier from a type/source field or free text. */
function inferTier(raw: string | null | undefined): PartSourcingTier {
  const s = (raw ?? '').toUpperCase();
  if (/LKQ|RECYCL|SALVAGE|\bUSED\b/.test(s)) return 'LKQ';
  if (/RECOND|REMAN|REBUILT|REFURB/.test(s)) return 'RECONDITIONED';
  if (/AFTERMARKET|A\/M|\bA-?M\b|NON.?OEM|\bAFTM\b/.test(s)) return 'AFTERMARKET';
  return 'OEM';
}

/** Infers CAPA certification from a flag/text; undefined when unknown. */
function inferCapa(raw: string | null | undefined): boolean | undefined {
  const s = (raw ?? '').toUpperCase();
  if (/NON.?CAPA|NOT\s*CERT/.test(s)) return false;
  if (/\bCAPA\b|CERTIFIED/.test(s)) return true;
  return undefined;
}

/** Parses a currency/number-ish value; undefined when not numeric. */
function num(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** First present, non-null value among the candidate keys. */
function pick(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] != null && record[key] !== '') return record[key];
  }
  return undefined;
}

const PART_KEYS = ['PartNumber', 'partNumber', 'part_number', 'PartNum', 'OEMPartNumber', 'oem_part_number', 'PartNo'];
const DESC_KEYS = ['Description', 'description', 'LineDescription', 'PartDescription', 'desc', 'name', 'Name'];
const QTY_KEYS = ['Quantity', 'quantity', 'qty', 'Qty', 'QTY'];
const COST_KEYS = ['UnitCost', 'unitCost', 'unit_cost', 'UnitPrice', 'Price', 'price', 'ListPrice'];
const VENDOR_KEYS = ['VendorName', 'vendorName', 'vendor_name', 'Vendor', 'Supplier', 'supplier'];
const TIER_KEYS = ['SourcingTier', 'sourcingTier', 'PartType', 'partType', 'part_type', 'LineType', 'type', 'source'];
const CAPA_KEYS = ['CAPA', 'capa', 'capaCertified', 'Certified', 'certification', 'cert'];

/** Normalizes a loose record into a PartsLineItem, or null if it has no data. */
function normalizeRecord(record: Record<string, unknown>): PartsLineItem | null {
  const partNumber = pick(record, PART_KEYS);
  const description = pick(record, DESC_KEYS);
  const name = (description ?? partNumber) as string | undefined;
  const quantity = num(pick(record, QTY_KEYS));
  const unitCost = num(pick(record, COST_KEYS));

  // Skip empty rows.
  if (!name && quantity == null && unitCost == null) return null;

  const vendor = pick(record, VENDOR_KEYS);
  const tierRaw = pick(record, TIER_KEYS);
  const capaRaw = pick(record, CAPA_KEYS);

  const capaCertified =
    typeof capaRaw === 'boolean'
      ? capaRaw
      : inferCapa(`${capaRaw ?? ''} ${name ?? ''}`);

  return {
    name: (name ?? 'Part').toString().trim(),
    status: 'NEEDED',
    sourcingTier: inferTier(`${tierRaw ?? ''} ${name ?? ''}`),
    capaCertified,
    partNumber: partNumber != null ? String(partNumber).trim() : null,
    vendorName: vendor != null ? String(vendor).trim() : null,
    quantity: quantity ?? null,
    unitCost: unitCost ?? null,
  };
}

function keep(items: (PartsLineItem | null)[]): PartsLineItem[] {
  return items.filter((i): i is PartsLineItem => i !== null).slice(0, 250);
}

// --- JSON (CIECA BMS / generic) --------------------------------------------

/** Depth-first search for the first array of objects that look like line items. */
function findLineArray(node: unknown): Record<string, unknown>[] | null {
  const looksLikeLine = (o: unknown): o is Record<string, unknown> =>
    !!o &&
    typeof o === 'object' &&
    [...PART_KEYS, ...DESC_KEYS].some((k) => k in (o as Record<string, unknown>));

  if (Array.isArray(node)) {
    const lines = node.filter(looksLikeLine);
    if (lines.length > 0) return lines;
    for (const el of node) {
      const found = findLineArray(el);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      const found = findLineArray(value);
      if (found) return found;
    }
  }
  return null;
}

function parseJson(input: string): PartsLineItem[] {
  const data = JSON.parse(input);
  const rows = findLineArray(data) ?? [];
  return keep(rows.map(normalizeRecord));
}

// --- XML (CIECA BMS / EMS) --------------------------------------------------

const XML_LINE_ELEMENTS = [
  'DamageLineInformation',
  'LineInformation',
  'DamageLine',
  'LineItem',
  'Line',
  'PartInfo',
  'Part',
];

function elementToRecord(el: Element): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const child of Array.from(el.children)) {
    if (child.children.length === 0 && child.textContent) {
      record[child.tagName] = child.textContent.trim();
    }
  }
  for (const attr of Array.from(el.attributes)) record[attr.name] = attr.value;
  return record;
}

function parseXml(input: string): PartsLineItem[] {
  if (typeof DOMParser === 'undefined') return parseXmlRegex(input);
  const doc = new DOMParser().parseFromString(input, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return parseXmlRegex(input);

  let nodes: Element[] = [];
  for (const tag of XML_LINE_ELEMENTS) {
    const found = Array.from(doc.getElementsByTagName(tag));
    if (found.length > 0) {
      nodes = found;
      break;
    }
  }
  if (nodes.length === 0) return [];
  return keep(nodes.map((el) => normalizeRecord(elementToRecord(el))));
}

/** Regex fallback when DOMParser is unavailable (e.g. non-DOM runtime). */
function parseXmlRegex(input: string): PartsLineItem[] {
  let element: string | undefined;
  for (const name of XML_LINE_ELEMENTS) {
    if (new RegExp(`<${name}[\\s>]`).test(input)) {
      element = name;
      break;
    }
  }
  if (!element) return [];
  const blocks = input.match(new RegExp(`<${element}[\\s\\S]*?</${element}>`, 'g')) ?? [];
  return keep(
    blocks.map((block) => {
      const record: Record<string, unknown> = {};
      const tagRe = /<([A-Za-z_][\w.-]*)>([^<]*)<\/\1>/g;
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(block))) record[m[1]] = m[2].trim();
      return normalizeRecord(record);
    }),
  );
}

// --- CSV / tab / text -------------------------------------------------------

/** Splits one delimited line, honoring simple double-quoted fields. */
function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

function parseCsv(input: string): PartsLineItem[] {
  const lines = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const rows = lines.map((l) => splitDelimited(l, delimiter));

  const header = rows[0].map((c) => c.toLowerCase());
  const hasHeader = header.some((h) => /desc|part/.test(h)) && !/\d/.test(rows[0].join(''));

  if (hasHeader) {
    const idx = (needles: string[]) =>
      header.findIndex((h) => needles.some((n) => h.includes(n)));
    const cols = {
      part: idx(['part']),
      desc: idx(['desc']),
      qty: idx(['qty', 'quantity']),
      cost: idx(['cost', 'price']),
      vendor: idx(['vendor', 'supplier']),
      tier: idx(['tier', 'type', 'source']),
      capa: idx(['capa', 'cert']),
    };
    const at = (row: string[], i: number) => (i >= 0 ? row[i] : undefined);
    return keep(
      rows.slice(1).map((row) =>
        normalizeRecord({
          PartNumber: at(row, cols.part),
          Description: at(row, cols.desc),
          Quantity: at(row, cols.qty),
          UnitCost: at(row, cols.cost),
          VendorName: at(row, cols.vendor),
          SourcingTier: at(row, cols.tier),
          CAPA: at(row, cols.capa),
        }),
      ),
    );
  }

  // Positional: partNumber, description, quantity, unitCost, tier, capa
  return keep(
    rows.map((row) =>
      normalizeRecord({
        PartNumber: row[0],
        Description: row[1],
        Quantity: row[2],
        UnitCost: row[3],
        SourcingTier: row[4],
        CAPA: row[5],
      }),
    ),
  );
}

// --- dispatcher -------------------------------------------------------------

/** Parses an estimate export (auto-detecting JSON / XML / CSV-text). */
export function parseEstimate(input: string): PartsLineItem[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  try {
    if (trimmed[0] === '{' || trimmed[0] === '[') return parseJson(trimmed);
    if (trimmed[0] === '<') return parseXml(trimmed);
    return parseCsv(trimmed);
  } catch {
    // Any parser blow-up → let the caller fall back to the demo seed.
    return [];
  }
}

// --- demo seed --------------------------------------------------------------

/**
 * Generates a realistic 7-line estimate for quick-seeding / testing, or as a
 * fallback when pasted text can't be parsed. Deterministic (no randomness).
 */
export function seedDemoEstimateParts(claimNumber: string): PartsLineItem[] {
  const suffix = claimNumber.replace(/[^0-9]/g, '').slice(-4) || '0000';
  return [
    {
      name: 'Front bumper cover',
      status: 'NEEDED',
      sourcingTier: 'AFTERMARKET',
      capaCertified: true,
      partNumber: `AM-BC-${suffix}`,
      vendorName: 'Keystone',
      quantity: 1,
      unitCost: 289.0,
    },
    {
      name: 'OEM impact bar / reinforcement',
      status: 'NEEDED',
      sourcingTier: 'OEM',
      partNumber: `OE-IB-${suffix}`,
      vendorName: 'Dealer',
      quantity: 1,
      unitCost: 412.5,
    },
    {
      name: 'Headlamp assembly (LH)',
      status: 'NEEDED',
      sourcingTier: 'AFTERMARKET',
      capaCertified: true,
      partNumber: `AM-HL-${suffix}L`,
      vendorName: 'Depo (CAPA)',
      quantity: 1,
      unitCost: 176.75,
    },
    {
      name: 'Front bumper absorber',
      status: 'NEEDED',
      sourcingTier: 'LKQ',
      partNumber: `LKQ-AB-${suffix}`,
      vendorName: 'LKQ Corp',
      quantity: 1,
      unitCost: 64.0,
    },
    {
      name: 'A/C compressor',
      status: 'NEEDED',
      sourcingTier: 'RECONDITIONED',
      partNumber: `RM-AC-${suffix}`,
      vendorName: 'Four Seasons (Reman)',
      quantity: 1,
      unitCost: 198.0,
    },
    {
      name: 'Grille assembly',
      status: 'NEEDED',
      sourcingTier: 'OEM',
      partNumber: `OE-GR-${suffix}`,
      vendorName: 'Dealer',
      quantity: 1,
      unitCost: 231.25,
    },
    {
      name: 'Radiator support (tie bar)',
      status: 'NEEDED',
      sourcingTier: 'OEM',
      partNumber: `OE-RS-${suffix}`,
      vendorName: 'Dealer',
      quantity: 1,
      unitCost: 305.0,
    },
  ];
}
