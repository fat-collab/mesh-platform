'use client';

/**
 * ReserveVehicleModal — fleet vehicle picker for reserving a loaner.
 *
 * Was an inline <select> cramped into the lead card (RoutingActionPanel);
 * this shows live fleet inventory (mileage, fuel, plate) per unit so a rep
 * can actually compare before locking one in. Reserving holds the vehicle
 * (RESERVED, bound to this lead) without fabricating checkout data — real
 * mileage/fuel are only captured later, at physical handoff (Fleet Command
 * Center's Confirm Pickup).
 *
 * No longer touches lead routing (MESH is shop-only; routing_path/
 * dispatch_status were removed) — reserving a loaner and how the vehicle's
 * repair is routed are independent facts. See LoanerReserveButton, the
 * lead-card entry point this is opened from.
 */
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { getAvailableVehicles, reserveVehicle } from '@/lib/rental-db';
import type { IntakeLead, RentalVehicle } from '@/components/sales/types';

interface ReserveVehicleModalProps {
  lead: IntakeLead;
  onClose: () => void;
  onReserved: () => void;
}

export function ReserveVehicleModal({ lead, onClose, onReserved }: ReserveVehicleModalProps) {
  const [vehicles, setVehicles] = useState<RentalVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [reservingId, setReservingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await getAvailableVehicles();
      if (!cancelled) {
        setVehicles(rows);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reserve = async (vehicleId: string) => {
    setReservingId(vehicleId);
    setError(null);
    try {
      await reserveVehicle(vehicleId, lead.id, lead.customerName);
      onReserved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reserve fleet vehicle.');
      setReservingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Reserve a fleet vehicle"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-xl"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-bold text-zinc-100">Reserve a Vehicle</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-zinc-500">
          For {lead.customerName} — holds the unit; real mileage/fuel are captured at pickup.
        </p>

        {error && (
          <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-zinc-500">Loading fleet inventory…</p>
        ) : vehicles.length === 0 ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            No fleet units currently available.
          </p>
        ) : (
          <ul className="space-y-2">
            {vehicles.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-100">{v.makeModel}</p>
                  <p className="truncate text-[11px] text-zinc-500">
                    {v.id} · {v.licensePlate} · {v.currentMileage.toLocaleString()} mi · {v.fuelLevel}%
                    fuel
                  </p>
                </div>
                <button
                  type="button"
                  disabled={reservingId !== null}
                  onClick={() => void reserve(v.id)}
                  className={clsx(
                    'shrink-0 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-500 disabled:opacity-50',
                  )}
                >
                  {reservingId === v.id ? 'Reserving…' : 'Reserve'}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={reservingId !== null}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
