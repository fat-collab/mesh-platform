'use client';

/**
 * FleetRentalTracker — external rental + shop-fleet reimbursement tracking for a
 * repair order: active rentals with policy-expiry countdowns (vs. repair ETA),
 * reimbursement collection status, and an Executive/Manager override that
 * authorizes closeout while outstanding reimbursements remain in collection.
 *
 * Reads customer_rentals / rental_reimbursements via the browser Supabase client
 * (service-role key bypasses RLS); the override PATCHes the closeout route.
 */
import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { getSupabaseBrowserClient } from '@/lib/supabase';

type RentalStatus = 'ACTIVE' | 'EXTENDED' | 'EXPIRED' | 'RETURNED';
type ReimbStatus = 'PENDING' | 'PARTIAL' | 'COLLECTED' | 'DISPUTED';

interface CustomerRental {
  id: string;
  rental_company: string;
  claimant_name: string | null;
  policy_max_days: number | null;
  rental_expiry_date: string | null;
  daily_rate: number | null;
  status: RentalStatus;
}

interface RentalReimbursement {
  id: string;
  provider_type: 'EXTERNAL_INSURANCE' | 'SHOP_FLEET';
  claimed_amount: number | null;
  collected_amount: number | null;
  status: ReimbStatus;
  notes: string | null;
}

const OVERRIDE_ROLES = new Set(['EXECUTIVE', 'MANAGER']);

const RENTAL_TONE: Record<RentalStatus, string> = {
  ACTIVE: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  EXTENDED: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  EXPIRED: 'border-red-500/50 bg-red-500/10 text-red-300',
  RETURNED: 'border-zinc-600/60 bg-zinc-700/40 text-zinc-300',
};

const REIMB_TONE: Record<ReimbStatus, string> = {
  PENDING: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  PARTIAL: 'border-orange-500/40 bg-orange-500/10 text-orange-300',
  COLLECTED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  DISPUTED: 'border-red-500/50 bg-red-500/10 text-red-300',
};

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

/** Whole days from today to an ISO date (negative = past). */
function daysUntil(date: string | null): number | null {
  if (!date) return null;
  return Math.ceil((Date.parse(date) - Date.now()) / 86_400_000);
}

export interface FleetRentalTrackerProps {
  repairOrderId: string;
  /** Acting user's role — gates the override action. */
  userRole?: string;
  /** Repair ETA (ISO date) to compare against rental policy expiry. */
  repairEtaDate?: string;
  /** Called after a successful override-close. */
  onClosed?: () => void;
}

export function FleetRentalTracker({
  repairOrderId,
  userRole,
  repairEtaDate,
  onClosed,
}: FleetRentalTrackerProps) {
  const [rentals, setRentals] = useState<CustomerRental[]>([]);
  const [reimbursements, setReimbursements] = useState<RentalReimbursement[]>([]);
  const [loading, setLoading] = useState(true);
  const [overriding, setOverriding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const [rentalRes, reimbRes] = await Promise.all([
      supabase
        .from('customer_rentals')
        .select('*')
        .eq('repair_order_id', repairOrderId)
        .order('created_at', { ascending: true }),
      supabase
        .from('rental_reimbursements')
        .select('*')
        .eq('repair_order_id', repairOrderId)
        .order('created_at', { ascending: true }),
    ]);
    setRentals((rentalRes.data as CustomerRental[] | null) ?? []);
    setReimbursements((reimbRes.data as RentalReimbursement[] | null) ?? []);
  }, [repairOrderId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const pendingReimb = reimbursements.filter((r) => r.status === 'PENDING' || r.status === 'PARTIAL');
  const outstanding = pendingReimb.reduce(
    (sum, r) => sum + ((r.claimed_amount ?? 0) - (r.collected_amount ?? 0)),
    0,
  );
  const canOverride = !!userRole && OVERRIDE_ROLES.has(userRole);
  const etaDays = daysUntil(repairEtaDate ?? null);

  const handleOverride = async () => {
    if (overriding) return;
    setOverriding(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/repair-orders/${repairOrderId}/close`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrideRentalBlock: true, userRole }),
      });
      const json = (await res.json()) as { success?: boolean; message?: string; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error || 'Override failed.');
      setNotice(json.message || 'Closeout authorized with rental override.');
      onClosed?.();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Override failed.');
    } finally {
      setOverriding(false);
    }
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Fleet &amp; Rentals
      </h3>
      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        {loading ? (
          <p className="text-xs text-zinc-500">Loading rentals…</p>
        ) : (
          <>
            {/* Active rentals + expiry vs ETA */}
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                External rentals
              </p>
              {rentals.length === 0 ? (
                <p className="text-xs text-zinc-500">No rentals on this order.</p>
              ) : (
                <ul className="space-y-1.5">
                  {rentals.map((r) => {
                    const left = daysUntil(r.rental_expiry_date);
                    const etaExceeds = etaDays != null && left != null && etaDays > left;
                    return (
                      <li
                        key={r.id}
                        className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm text-zinc-100">{r.rental_company}</span>
                          <span
                            className={clsx(
                              'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold',
                              RENTAL_TONE[r.status],
                            )}
                          >
                            {r.status}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                          {r.claimant_name ?? '—'}
                          {r.daily_rate != null ? ` · ${money(r.daily_rate)}/day` : ''}
                          {r.policy_max_days != null ? ` · cap ${r.policy_max_days}d` : ''}
                        </p>
                        {r.rental_expiry_date && (
                          <p
                            className={clsx(
                              'mt-0.5 text-[11px]',
                              left != null && left < 0
                                ? 'text-red-300'
                                : etaExceeds
                                  ? 'text-amber-300'
                                  : 'text-zinc-500',
                            )}
                          >
                            {left != null && left < 0
                              ? `Expired ${Math.abs(left)}d ago`
                              : `Expires in ${left}d`}
                            {etaExceeds && ` · repair ETA (${etaDays}d) exceeds policy`}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Reimbursement tracking */}
            <div className="border-t border-zinc-800 pt-2">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500">Reimbursements</p>
                {outstanding > 0 && (
                  <span className="text-[11px] font-semibold tabular-nums text-amber-300">
                    {money(outstanding)} outstanding
                  </span>
                )}
              </div>
              {reimbursements.length === 0 ? (
                <p className="text-xs text-zinc-500">No reimbursements tracked.</p>
              ) : (
                <ul className="space-y-1.5">
                  {reimbursements.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-xs"
                    >
                      <span className="min-w-0 truncate text-zinc-200">
                        {r.provider_type === 'SHOP_FLEET' ? 'Shop Fleet' : 'External Insurance'}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums text-zinc-400">
                          {money(r.collected_amount ?? 0)} / {money(r.claimed_amount ?? 0)}
                        </span>
                        <span
                          className={clsx(
                            'rounded-md border px-1.5 py-0.5 text-[10px] font-semibold',
                            REIMB_TONE[r.status],
                          )}
                        >
                          {r.status}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Managerial override */}
            {pendingReimb.length > 0 && (
              <div className="border-t border-zinc-800 pt-2">
                {canOverride ? (
                  <button
                    type="button"
                    onClick={() => void handleOverride()}
                    disabled={overriding}
                    className="w-full rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                  >
                    {overriding
                      ? 'Overriding…'
                      : `⚠ Override rental block & authorize closeout (${pendingReimb.length} pending)`}
                  </button>
                ) : (
                  <p className="rounded-md border border-zinc-700 bg-zinc-800/40 px-2 py-1.5 text-[11px] text-zinc-400">
                    {pendingReimb.length} reimbursement(s) pending — Executive/Manager override
                    required to close.
                  </p>
                )}
                {notice && <p className="mt-1.5 text-[11px] text-zinc-400">{notice}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
