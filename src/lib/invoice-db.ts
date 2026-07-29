/**
 * MESH Ops — repair-order invoice / A/R data access layer.
 *
 * One invoice per RO backed by the repair_order_invoices table, with a
 * session-local fallback. Mirrors the DB-first + fallback pattern of parts-db.ts.
 */
import { getSupabaseBrowserClient } from './supabase';
import { executeDBOperation } from './db-guard';
import type { InvoiceStatus, RepairOrderInvoice } from '@/components/ops/ro-invoice-types';

const TABLE = 'repair_order_invoices';

interface InvoiceRow {
  id: string;
  repair_order_id: string;
  invoice_number: string;
  status: InvoiceStatus;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  paid_at: string | null;
  created_at: string;
}

function rowToInvoice(row: InvoiceRow): RepairOrderInvoice {
  return {
    id: row.id,
    repairOrderId: row.repair_order_id,
    invoiceNumber: row.invoice_number,
    status: row.status,
    subtotal: row.subtotal ?? 0,
    tax: row.tax ?? 0,
    total: row.total ?? 0,
    paidAt: row.paid_at ?? undefined,
    createdAt: row.created_at,
  };
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `inv-${crypto.randomUUID()}`;
  }
  return `inv-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

function invoiceNumberFor(repairOrderId: string): string {
  const tail = repairOrderId.replace(/[^a-z0-9]/gi, '').slice(-5).toUpperCase();
  return `INV-${tail || '00000'}`;
}

// Session-local fallback store, keyed by repair order id (one invoice per RO).
const localInvoices = new Map<string, RepairOrderInvoice>([
  [
    'mock-a6f1',
    {
      id: 'seed-mock-a6f1-invoice',
      repairOrderId: 'mock-a6f1',
      invoiceNumber: 'INV-A6F1',
      status: 'SENT',
      subtotal: 3241.14,
      tax: 267.39,
      total: 3508.53,
      createdAt: '2026-07-27T16:00:00.000Z',
    },
  ],
]);

/** Loads the invoice for a repair order, or null if none exists yet. */
export async function getInvoice(repairOrderId: string): Promise<RepairOrderInvoice | null> {
  const supabase = getSupabaseBrowserClient();
  const result = await executeDBOperation<InvoiceRow | null>(
    'getInvoice',
    async () => {
      const res = await supabase
        .from(TABLE)
        .select('*')
        .eq('repair_order_id', repairOrderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return { data: res.data as unknown as InvoiceRow | null, error: res.error };
    },
    null,
  );
  if (result.data) return rowToInvoice(result.data);
  return localInvoices.get(repairOrderId) ?? null;
}

/** Generates (or regenerates) the invoice for a repair order. */
export async function generateInvoice(
  repairOrderId: string,
  subtotal: number,
  tax: number,
): Promise<RepairOrderInvoice> {
  const total = Number((subtotal + tax).toFixed(2));
  const invoiceNumber = invoiceNumberFor(repairOrderId);

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        repair_order_id: repairOrderId,
        invoice_number: invoiceNumber,
        status: 'DRAFT',
        subtotal,
        tax,
        total,
      })
      .select('*')
      .single();
    if (!error && data) {
      return rowToInvoice(data as unknown as InvoiceRow);
    }
  } catch {
    /* fall through to local store */
  }

  const invoice: RepairOrderInvoice = {
    id: genId(),
    repairOrderId,
    invoiceNumber,
    status: 'DRAFT',
    subtotal,
    tax,
    total,
    createdAt: new Date().toISOString(),
  };
  localInvoices.set(repairOrderId, invoice);
  return invoice;
}

/** Updates an invoice's payment status (stamps paid_at on PAID). */
export async function updateInvoiceStatus(
  invoiceId: string,
  status: InvoiceStatus,
): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status };
  if (status === 'PAID') patch.paid_at = now;

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from(TABLE)
      .update(patch)
      .eq('id', invoiceId)
      .select('id');
    if (!error && data && data.length > 0) return;
  } catch {
    /* fall through to local */
  }
  for (const inv of localInvoices.values()) {
    if (inv.id === invoiceId) {
      inv.status = status;
      if (status === 'PAID') inv.paidAt = now;
      return;
    }
  }
}
