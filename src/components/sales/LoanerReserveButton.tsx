'use client';

/**
 * LoanerReserveButton — reserve a fleet loaner for a lead, independent of
 * how (or whether) the vehicle's repair is routed.
 *
 * Split out of RoutingActionPanel during the mobile-dispatch/routing
 * removal (MESH is shop-only; routing_path/dispatch_status modeled a
 * business this app isn't in). A customer may need a loaner regardless of
 * lead status — the old NEW/CONVERTED/terminal gating was a routing-flow
 * artifact, not a fleet-availability one, so this renders unconditionally
 * on status. Preserves the Shop Fleet Toggle from RoutingActionPanel: a
 * shop without a loaner fleet must not see a reserve control at all.
 *
 * Unlike the old panel, this never shows a persistent "already reserved"
 * state — that badge read routing_path as a cheap proxy for "a vehicle is
 * held," which no longer exists. Determining that accurately now would mean
 * querying rental_vehicles per lead; simpler to just always offer Reserve
 * (ReserveVehicleModal shows live available inventory either way, so
 * reserving again — e.g. to swap units — is harmless).
 */
import { useEffect, useState } from 'react';
import { ReserveVehicleModal } from '@/components/sales/ReserveVehicleModal';
import type { IntakeLead } from '@/components/sales/types';

interface LoanerReserveButtonProps {
  lead: IntakeLead;
  onUpdated: () => void;
}

export function LoanerReserveButton({ lead, onUpdated }: LoanerReserveButtonProps) {
  const [showReserveModal, setShowReserveModal] = useState(false);
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

  if (!hasFleet) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setShowReserveModal(true)}
        className="w-full rounded border border-teal-600/50 px-1.5 py-1 text-[10.5px] font-semibold text-teal-300 transition-colors hover:bg-teal-500/10"
      >
        🚗 Reserve Loaner
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
