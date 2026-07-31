'use client';

/**
 * RoutingActionPanel — the post-contact dual-path routing switch on a lead
 * card: Book Shop Drop-off + Fleet Reservation, or Dispatch Mobile House
 * Call. Once a path is chosen it renders the resulting state (a reserved
 * loaner, or the field dispatch lifecycle control) instead of the switch.
 */
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { updateLeadRouting, updateDispatchStatus } from '@/lib/sales-db';
import { getAvailableVehicles, reserveVehicle } from '@/lib/rental-db';
import {
  DISPATCH_STATUS_LABEL,
  DISPATCH_STATUS_ORDER,
  type DispatchStatus,
  type IntakeLead,
} from '@/components/sales/types';
import type { RentalVehicle } from '@/components/sales/types';

interface RoutingActionPanelProps {
  lead: IntakeLead;
  onUpdated: () => void;
}

type Mode = 'idle' | 'shop' | 'mobile';

export function RoutingActionPanel({ lead, onUpdated }: RoutingActionPanelProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const [vehicles, setVehicles] = useState<RentalVehicle[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [agentName, setAgentName] = useState('');
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

  useEffect(() => {
    if (mode !== 'shop' || !hasFleet) return;
    let cancelled = false;
    void (async () => {
      const rows = await getAvailableVehicles();
      if (!cancelled) {
        setVehicles(rows);
        setVehicleId(rows[0]?.id ?? '');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, hasFleet]);

  const confirmShopDropoff = async () => {
    if (!vehicleId) {
      setError('Select a loaner to reserve.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Hold, don't check out — mileage/fuel aren't known yet here (the
      // customer hasn't picked the vehicle up); Fleet Command Center
      // confirms pickup into RENTED once the real numbers are captured.
      await reserveVehicle(vehicleId, lead.id, lead.customerName);
      await updateLeadRouting(lead.id, 'SHOP_DROPOFF');
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reserve fleet vehicle.');
    } finally {
      setBusy(false);
    }
  };

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

  const confirmMobileDispatch = async () => {
    if (!agentName.trim()) {
      setError('Enter the field agent to dispatch.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateLeadRouting(lead.id, 'MOBILE_HOUSE_CALL', agentName);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dispatch field agent.');
    } finally {
      setBusy(false);
    }
  };

  const advanceDispatch = async (status: DispatchStatus) => {
    setBusy(true);
    try {
      await updateDispatchStatus(lead.id, status);
      onUpdated();
    } finally {
      setBusy(false);
    }
  };

  // Already routed — show the resulting state instead of the switch.
  if (lead.routingPath === 'SHOP_DROPOFF') {
    return (
      <div className="mt-2 rounded-md border border-teal-500/30 bg-teal-500/10 px-2 py-1.5 text-[11px] font-medium text-teal-200">
        🚗 {hasFleet ? 'Shop Drop-off · Fleet Reserved' : 'Shop Drop-off Booked'}
      </div>
    );
  }

  if (lead.routingPath === 'MOBILE_HOUSE_CALL') {
    const status = lead.dispatchStatus ?? 'DISPATCHED';
    return (
      <div className="mt-2 space-y-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1.5">
        <p className="truncate text-[11px] font-medium text-sky-200">
          🧭 Mobile House Call · {lead.dispatchStaffName ?? 'Unassigned'}
        </p>
        <select
          value={status}
          disabled={busy}
          onChange={(e) => void advanceDispatch(e.target.value as DispatchStatus)}
          aria-label={`Dispatch status for ${lead.customerName}`}
          className="w-full rounded border border-sky-700/50 bg-zinc-950/70 px-1.5 py-0.5 text-[11px] font-medium text-sky-100 focus:outline-none"
        >
          {DISPATCH_STATUS_ORDER.map((s) => (
            <option key={s} value={s} className="bg-zinc-900">
              {DISPATCH_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (mode === 'shop') {
    return (
      <div className="mt-2 space-y-1.5 rounded-md border border-zinc-700 bg-zinc-950/60 p-2">
        {error && <p className="text-[11px] text-red-300">{error}</p>}
        <select
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          aria-label="Available fleet vehicle"
          className="w-full rounded border border-zinc-700 bg-zinc-950/70 px-1.5 py-1 text-[11px] text-zinc-200 focus:outline-none"
        >
          {vehicles.length === 0 ? (
            <option value="">No vehicles available</option>
          ) : (
            vehicles.map((v) => (
              <option key={v.id} value={v.id} className="bg-zinc-900">
                {v.makeModel} · {v.licensePlate}
              </option>
            ))
          )}
        </select>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={busy || vehicles.length === 0}
            onClick={() => void confirmShopDropoff()}
            className="flex-1 rounded bg-teal-600 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-teal-500 disabled:opacity-50"
          >
            {busy ? 'Reserving…' : 'Confirm reservation'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode('idle')}
            className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'mobile') {
    return (
      <div className="mt-2 space-y-1.5 rounded-md border border-zinc-700 bg-zinc-950/60 p-2">
        {error && <p className="text-[11px] text-red-300">{error}</p>}
        <input
          autoFocus
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          placeholder="Field agent name…"
          aria-label="Field agent name"
          className="w-full rounded border border-zinc-700 bg-zinc-950/70 px-1.5 py-1 text-[11px] text-zinc-100 focus:outline-none"
        />
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirmMobileDispatch()}
            className="flex-1 rounded bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? 'Dispatching…' : 'Confirm dispatch'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode('idle')}
            className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      {error && <p className="text-[11px] text-red-300">{error}</p>}
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setError(null);
            // No fleet to allocate — book the drop-off directly instead of
            // opening the vehicle-selection sub-panel.
            if (!hasFleet) {
              void confirmShopDropoffNoFleet();
              return;
            }
            setMode('shop');
          }}
          className={clsx(
            'rounded border border-teal-600/50 px-1.5 py-1 text-[10.5px] font-semibold text-teal-300 transition-colors hover:bg-teal-500/10 disabled:opacity-50',
          )}
        >
          {busy && !hasFleet ? 'Booking…' : 'Book Shop Drop-off'}
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode('mobile');
          }}
          className={clsx(
            'rounded border border-sky-600/50 px-1.5 py-1 text-[10.5px] font-semibold text-sky-300 transition-colors hover:bg-sky-500/10',
          )}
        >
          Dispatch Mobile
        </button>
      </div>
    </div>
  );
}
