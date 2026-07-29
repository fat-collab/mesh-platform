/**
 * MESH Ops — repair-order invoice / accounts-receivable model (RO-scoped).
 *
 * One RO → one invoice, rolling up base + parts + approved supplements + labor
 * into subtotal / tax / total with a payment lifecycle.
 */

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PAID' | 'VOID';

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  PAID: 'Paid',
  VOID: 'Void',
};

export const INVOICE_STATUS_ORDER: InvoiceStatus[] = ['DRAFT', 'SENT', 'PAID', 'VOID'];

export interface RepairOrderInvoice {
  id: string;
  repairOrderId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  subtotal: number;
  tax: number;
  total: number;
  paidAt?: string;
  createdAt: string;
}
