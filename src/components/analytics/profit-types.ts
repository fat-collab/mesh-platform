/**
 * MESH Analytics — executive profit & margin-leakage model.
 *
 * Rolls a single repair order's parts / labor / invoice into a profitability
 * picture, and defines the shop-wide KPI shape.
 *
 * Margin-leakage model: `RepairOrderPart` has no per-line "applied discount"
 * field, so the billed `cost` is treated as supplier list, and each part type
 * carries an EXPECTED wholesale/shop discount the shop should capture. A line
 * whose expected discount is material (≥ threshold) is flagged as potential
 * leakage — a discount that should be verified/collected from the supplier.
 */
import type { BoardOrder } from '@/lib/board';
import type { PartType, RepairOrderPart } from '@/components/ops/ro-parts-types';
import type { RepairOrderLaborEntry } from '@/components/ops/ro-labor-types';
import type { RepairOrderInvoice } from '@/components/ops/ro-invoice-types';

// --- financial baselines ----------------------------------------------------
export const LABOR_BILL_RATE = 95; // $/hr billed to the customer
export const LABOR_COST_RATE = 45; // $/hr technician wage (COGS)
export const BASE_FEE = 250; // shop supplies / base charge

/**
 * Expected wholesale/shop discount by part sourcing type — the margin the shop
 * should capture off supplier list. When a supplier omits it, that's leakage.
 */
export const EXPECTED_DISCOUNT_RATE: Record<PartType, number> = {
  OEM: 0.25,
  AFTERMARKET: 0.3,
  SALVAGE: 0.4,
  USED: 0.35,
};

/** A part line is flagged when its expected (unrealized) discount meets this $. */
export const LEAKAGE_FLAG_THRESHOLD = 40;

// --- shapes -----------------------------------------------------------------
export interface DashboardMetrics {
  totalRevenue: number;
  grossProfit: number;
  averageROValue: number;
  /** Labor efficiency: total estimated ÷ total actual hours (>1 = beating book). */
  shopUtilizationRate: number;
  totalDiscountLeakage: number;
}

export interface FlaggedPartLine {
  partName: string;
  partType: PartType;
  billed: number;
  expectedDiscount: number;
}

export interface ROProfitability {
  repairOrderId: string;
  revenue: number;
  partsBilled: number;
  laborCost: number;
  grossProfit: number;
  /** grossProfit ÷ revenue (0–1). */
  netMargin: number;
  estimatedHours: number;
  actualHours: number;
  /** Estimated − actual hours (positive = under book time). */
  laborEfficiencyVariance: number;
  /** Expected dealer-discount exposure across all part lines ($). */
  partCostVariance: number;
  /** Leakage from flagged lines only ($). */
  discountLeakage: number;
  flaggedParts: FlaggedPartLine[];
}

const r2 = (n: number) => Number(n.toFixed(2));

/**
 * Computes profitability for one repair order from its parts, labor, and
 * invoice. `invoice` is nullable (one invoice per RO; null until generated).
 */
export function calculateROProfitability(
  ro: BoardOrder,
  parts: RepairOrderPart[],
  labor: RepairOrderLaborEntry[],
  invoice: RepairOrderInvoice | null,
): ROProfitability {
  const partsBilled = parts.reduce((s, p) => s + p.cost, 0);
  const expectedPartsCost = parts.reduce(
    (s, p) => s + p.cost * (1 - EXPECTED_DISCOUNT_RATE[p.partType]),
    0,
  );
  const partCostVariance = r2(partsBilled - expectedPartsCost);

  const estimatedHours = r2(labor.reduce((s, e) => s + e.estimatedHours, 0));
  const actualHours = r2(labor.reduce((s, e) => s + e.actualHours, 0));
  const laborEfficiencyVariance = r2(estimatedHours - actualHours);
  const laborCost = r2(actualHours * LABOR_COST_RATE);
  const laborBilled = actualHours * LABOR_BILL_RATE;

  // Revenue: invoice pre-tax subtotal when invoiced, else implied (base + parts
  // billed + labor billed) so uninvoiced ROs still contribute pipeline value.
  const revenue = r2(invoice?.subtotal ?? BASE_FEE + partsBilled + laborBilled);

  const flaggedParts: FlaggedPartLine[] = parts
    .map((p) => ({
      partName: p.partName,
      partType: p.partType,
      billed: r2(p.cost),
      expectedDiscount: r2(p.cost * EXPECTED_DISCOUNT_RATE[p.partType]),
    }))
    .filter((f) => f.expectedDiscount >= LEAKAGE_FLAG_THRESHOLD);
  const discountLeakage = r2(flaggedParts.reduce((s, f) => s + f.expectedDiscount, 0));

  const grossProfit = r2(revenue - expectedPartsCost - laborCost);
  const netMargin = revenue > 0 ? Number((grossProfit / revenue).toFixed(4)) : 0;

  return {
    repairOrderId: ro.id,
    revenue,
    partsBilled: r2(partsBilled),
    laborCost,
    grossProfit,
    netMargin,
    estimatedHours,
    actualHours,
    laborEfficiencyVariance,
    partCostVariance,
    discountLeakage,
    flaggedParts,
  };
}
