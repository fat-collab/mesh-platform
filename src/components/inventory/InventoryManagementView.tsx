'use client';

/**
 * InventoryManagementView — shop parts catalog, low-stock alerts, per-part
 * vendor price comparison, and one-click PO generation from low-stock items.
 * Backed by inventory-db (DB-first with a session-local fallback).
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  getCatalogItems,
  getSupplierPriceMatrix,
  createPurchaseOrder,
  type CreatePOItemInput,
} from '@/lib/inventory-db';
import type { CatalogItem, SupplierPartMatrix } from '@/components/inventory/inventory-types';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export function InventoryManagementView() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<Record<string, SupplierPartMatrix[]>>({});
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setCatalog(await getCatalogItems());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const items = await getCatalogItems();
      if (!cancelled) {
        setCatalog(items);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleRow = async (partId: string) => {
    if (expanded === partId) {
      setExpanded(null);
      return;
    }
    setExpanded(partId);
    if (!matrix[partId]) {
      const rows = await getSupplierPriceMatrix(partId);
      setMatrix((prev) => ({ ...prev, [partId]: rows }));
    }
  };

  const lowStock = catalog.filter((c) => c.currentStock < c.minStock);

  const handleGeneratePO = async () => {
    if (generating || lowStock.length === 0) return;
    setGenerating(true);
    setNotice(null);
    try {
      const bySupplier = new Map<string, CreatePOItemInput[]>();
      for (const item of lowStock) {
        const rows = matrix[item.id] ?? (await getSupplierPriceMatrix(item.id));
        if (!matrix[item.id]) setMatrix((prev) => ({ ...prev, [item.id]: rows }));
        if (rows.length === 0) continue;
        // Prefer the flagged supplier, else the cheapest (rows are price-sorted).
        const chosen = rows.find((r) => r.preferred) ?? rows[0];
        const qty = Math.max(1, item.minStock - item.currentStock);
        const list = bySupplier.get(chosen.supplierId) ?? [];
        list.push({ partId: item.id, quantity: qty, unitPrice: chosen.wholesalePrice });
        bySupplier.set(chosen.supplierId, list);
      }
      let poCount = 0;
      for (const [supplierId, items] of bySupplier) {
        await createPurchaseOrder(supplierId, items);
        poCount += 1;
      }
      setNotice(
        poCount > 0
          ? `Generated ${poCount} draft PO(s) covering ${lowStock.length} low-stock item(s).`
          : 'No supplier offers found for the low-stock items.',
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          {catalog.length} catalog parts ·{' '}
          <span className={lowStock.length > 0 ? 'text-red-300' : 'text-emerald-300'}>
            {lowStock.length} below min stock
          </span>
        </p>
        <button
          type="button"
          onClick={() => void handleGeneratePO()}
          disabled={generating || lowStock.length === 0}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
        >
          {generating ? 'Generating…' : `Generate PO from ${lowStock.length} low-stock`}
        </button>
      </div>

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-emerald-300/70 hover:text-emerald-200"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex h-48 items-center justify-center text-sm text-zinc-500">
          Loading catalog…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900/80 text-[11px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">Part</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 text-right font-medium">Stock</th>
                <th className="px-3 py-2 text-right font-medium">Min</th>
                <th className="px-3 py-2 text-center font-medium">Vendors</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {catalog.map((item) => {
                const low = item.currentStock < item.minStock;
                const open = expanded === item.id;
                const rows = matrix[item.id];
                return (
                  <Fragment key={item.id}>
                    <tr className={clsx('hover:bg-zinc-900/40', low && 'bg-red-950/10')}>
                      <td className="px-3 py-2 font-mono text-xs text-zinc-400">{item.sku}</td>
                      <td className="px-3 py-2 text-zinc-100">{item.name}</td>
                      <td className="px-3 py-2 text-zinc-500">{item.category ?? '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={clsx(
                            'inline-flex items-center gap-1 tabular-nums',
                            low ? 'font-semibold text-red-300' : 'text-zinc-300',
                          )}
                        >
                          {low && <span aria-hidden>⚠</span>}
                          {item.currentStock}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                        {item.minStock}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => void toggleRow(item.id)}
                          aria-expanded={open}
                          className="rounded-md border border-zinc-700 px-2 py-0.5 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800"
                        >
                          {open ? 'Hide' : 'Compare'}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-zinc-950/60">
                        <td colSpan={6} className="px-3 py-2">
                          {!rows ? (
                            <p className="text-[11px] text-zinc-500">Loading vendor prices…</p>
                          ) : rows.length === 0 ? (
                            <p className="text-[11px] text-zinc-500">No supplier offers on file.</p>
                          ) : (
                            <table className="w-full text-left text-xs">
                              <thead className="text-[10px] uppercase tracking-wider text-zinc-600">
                                <tr>
                                  <th className="px-2 py-1 font-medium">Supplier</th>
                                  <th className="px-2 py-1 font-medium">Supplier SKU</th>
                                  <th className="px-2 py-1 text-right font-medium">Wholesale</th>
                                  <th className="px-2 py-1 text-right font-medium">Lead</th>
                                  <th className="px-2 py-1 text-center font-medium">Pref</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((r, i) => (
                                  <tr key={r.supplierId} className="border-t border-zinc-800/60">
                                    <td className="px-2 py-1 text-zinc-200">{r.supplierName}</td>
                                    <td className="px-2 py-1 font-mono text-[11px] text-zinc-500">
                                      {r.supplierSku ?? '—'}
                                    </td>
                                    <td
                                      className={clsx(
                                        'px-2 py-1 text-right tabular-nums',
                                        i === 0 ? 'font-semibold text-emerald-300' : 'text-zinc-300',
                                      )}
                                    >
                                      {money(r.wholesalePrice)}
                                      {i === 0 && (
                                        <span className="ml-1 text-[10px] text-emerald-400/70">
                                          best
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1 text-right tabular-nums text-zinc-500">
                                      {r.leadTimeDays}d
                                    </td>
                                    <td className="px-2 py-1 text-center">
                                      {r.preferred ? (
                                        <span className="text-sky-300">★</span>
                                      ) : (
                                        <span className="text-zinc-700">—</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
