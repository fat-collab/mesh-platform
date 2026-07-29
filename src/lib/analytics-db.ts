/**
 * MESH Analytics — shop-wide profit & margin-leakage aggregation.
 *
 * Aggregates across repair orders by reading through the per-RO DALs (parts /
 * labor / invoice), each already DB-first with a session-local fallback. The RO
 * list comes from the board (Supabase when available, else MOCK_BOARD_ORDERS).
 */
import { getSupabaseBrowserClient } from './supabase';
import { fetchBoardOrders } from './ops-data';
import { MOCK_BOARD_ORDERS } from './ops-mock';
import { getParts } from './parts-db';
import { getLaborEntries } from './labor-db';
import { getInvoice } from './invoice-db';
import type { BoardOrder } from './board';
import {
  calculateROProfitability,
  type DashboardMetrics,
  type FlaggedPartLine,
} from '@/components/analytics/profit-types';

export interface FlaggedRO {
  repairOrderId: string;
  claimNumber: string | null;
  customerName: string | null;
  vehicle: string;
  netMargin: number;
  discountLeakage: number;
  flaggedParts: FlaggedPartLine[];
}

export interface ShopAnalyticsSummary {
  metrics: DashboardMetrics;
  flaggedROs: FlaggedRO[];
  repairOrderCount: number;
}

/** Loads the board-order list (Supabase when available, else sample). */
async function loadBoardOrders(): Promise<BoardOrder[]> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { orders, error } = await fetchBoardOrders(supabase);
    if (!error && orders.length > 0) return orders;
  } catch {
    /* fall through to sample */
  }
  return MOCK_BOARD_ORDERS;
}

/** High-level KPIs plus the ROs whose part discounts deviate from baseline. */
export async function getShopAnalyticsSummary(): Promise<ShopAnalyticsSummary> {
  const orders = await loadBoardOrders();

  const perRO = await Promise.all(
    orders.map(async (ro) => {
      const [parts, labor, invoice] = await Promise.all([
        getParts(ro.id),
        getLaborEntries(ro.id),
        getInvoice(ro.id),
      ]);
      return { ro, prof: calculateROProfitability(ro, parts, labor, invoice) };
    }),
  );

  let totalRevenue = 0;
  let grossProfit = 0;
  let totalDiscountLeakage = 0;
  let totalEst = 0;
  let totalAct = 0;
  let valuedCount = 0;
  const flaggedROs: FlaggedRO[] = [];

  for (const { ro, prof } of perRO) {
    totalRevenue += prof.revenue;
    grossProfit += prof.grossProfit;
    totalDiscountLeakage += prof.discountLeakage;
    totalEst += prof.estimatedHours;
    totalAct += prof.actualHours;
    if (prof.revenue > 0) valuedCount += 1;

    if (prof.flaggedParts.length > 0) {
      flaggedROs.push({
        repairOrderId: ro.id,
        claimNumber: ro.claim_number,
        customerName: ro.customer_name,
        vehicle: ro.vehicle,
        netMargin: prof.netMargin,
        discountLeakage: prof.discountLeakage,
        flaggedParts: prof.flaggedParts,
      });
    }
  }

  flaggedROs.sort((a, b) => b.discountLeakage - a.discountLeakage);

  const metrics: DashboardMetrics = {
    totalRevenue: Number(totalRevenue.toFixed(2)),
    grossProfit: Number(grossProfit.toFixed(2)),
    averageROValue: valuedCount > 0 ? Number((totalRevenue / valuedCount).toFixed(2)) : 0,
    shopUtilizationRate: totalAct > 0 ? Number((totalEst / totalAct).toFixed(4)) : 0,
    totalDiscountLeakage: Number(totalDiscountLeakage.toFixed(2)),
  };

  return { metrics, flaggedROs, repairOrderCount: orders.length };
}
