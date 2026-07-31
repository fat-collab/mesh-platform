'use client';

/**
 * RoutingActionPanel — Book Shop Drop-off on a lead card.
 *
 * Ops Workflow Realignment: this used to be a dual-path switch (Shop
 * Drop-off + Fleet Reservation, or Dispatch Mobile House Call). Mobile
 * dispatch moved entirely to Ops/Shop Managers (see DispatchButton) — Sales
 * reps neither trigger nor see it anymore. This panel now only ever offers
 * (or reflects) the shop drop-off path; a lead already routed to a mobile
 * house call renders nothing here.
 */
import { useEffect, useState } from 'react';
import { updateLeadRouting } from '@/lib/sales-db';
import { ReserveVehicleModal } from '@/components/sales/ReserveVehicleModal';
import type { IntakeLead } from '@/components/sales/types';

interface RoutingActionPanelProps {
  lead: IntakeLead;
  onUpdated: () => void;
}

export function RoutingActionPanel({ lead, onUpdated }: RoutingActionPanelProps) {
  const [showReserveModal, setShowReserveModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shop Fleet Toggle — partner/independent shops without a loaner fleet skip
  // vehicle allocation entirely on Shop Drop-off. Defaults to true (fleet
  // present) so behavior is unchanged until a shop explicitly opts out.
  const [hasFleet, setHasFleet] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/shop/config');
        const json = (await res.json()) as { config?: { hasFleet?: boolean } | null };
        if (!cancelled) setHasFleet(json.config?.hasFleet !== false);
      } catch {
        /* no config yet — default to fleet present */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // No-fleet path: book the drop-off directly, with no vehicle to allocate.
  const confirmShopDropoffNoFleet = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateLeadRouting(lead.id, 'SHOP_DROPOFF');
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to book shop drop-off.');
    } finally {
      setBusy(false);
    }
  };

  // Fully hidden from Sales — Ops/Shop Managers own mobile dispatch from
  // here on (DispatchButton), nothing left for this panel to show.
  if (lead.routingPath === 'MOBILE_HOUSE_CALL') return null;

  // Already routed — show the resulting state instead of the switch.
  if (lead.routingPath === 'SHOP_DROPOFF') {
    return (
      <div className="mt-2 rounded-md border border-teal-500/30 bg-teal-500/10 px-2 py-1.5 text-[11px] font-medium text-teal-200">
        🚗 {hasFleet ? 'Shop Drop-off · Fleet Reserved' : 'Shop Drop-off Booked'}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      {error && <p className="text-[11px] text-red-300">{error}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setError(null);
          // No fleet to allocate — book the drop-off directly instead of
          // opening the vehicle-reservation modal.
          if (!hasFleet) {
            void confirmShopDropoffNoFleet();
            return;
          }
          setShowReserveModal(true);
        }}
        className="w-full rounded border border-teal-600/50 px-1.5 py-1 text-[10.5px] font-semibold text-teal-300 transition-colors hover:bg-teal-500/10 disabled:opacity-50"
      >
        {busy && !hasFleet ? 'Booking…' : 'Book Shop Drop-off'}
      </button>

      {showReserveModal && (
        <ReserveVehicleModal
          lead={lead}
          onClose={() => setShowReserveModal(false)}
          onReserved={() => {
            setShowReserveModal(false);
            onUpdated();
          }}
        />
      )}
    </div>
  );
}
