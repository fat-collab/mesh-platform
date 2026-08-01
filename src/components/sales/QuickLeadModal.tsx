'use client';

/**
 * QuickLeadModal — Quick Porch Capture: the fastest possible lead entry for
 * a rep standing at a customer's door. Only a name is required — everything
 * else (phone, address, vehicle make, initial damage triage) is optional and
 * gets filled in later via the full intake. Distinct from DigitalIntakeQuickAdd
 * (web/social leads with a document vault) and MobileIntakeWizard (full
 * on-site capture with signature) — this is deliberately just enough to grab
 * the lead before it walks away.
 */
import { useState } from 'react';
import { createQuickLead, addLeadVehicle } from '@/lib/sales-db';
import {
  DAMAGE_TYPE_LABEL,
  STORM_SEVERITY_LABEL,
  STORM_SEVERITY_ORDER,
  type DamageType,
  type IntakeLead,
  type LeadVehicle,
  type StormSeverity,
} from '@/components/sales/types';

const DAMAGE_TYPES: DamageType[] = ['Collision', 'Hail', 'Dent', 'Glass'];

interface ExtraVehicleDraft {
  key: number;
  year: string;
  make: string;
  model: string;
  vin: string;
  severity: StormSeverity;
}

let draftKeySeq = 0;
function blankExtraVehicle(): ExtraVehicleDraft {
  draftKeySeq += 1;
  return { key: draftKeySeq, year: '', make: '', model: '', vin: '', severity: 'MODERATE' };
}

interface QuickLeadModalProps {
  onClose: () => void;
  onComplete: (lead: IntakeLead) => void;
}

export function QuickLeadModal({ onClose, onComplete }: QuickLeadModalProps) {
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [damageType, setDamageType] = useState<DamageType>('Collision');
  // A storm can hit more than one vehicle at the same property — the field
  // above stays the quick single-vehicle case; this covers #2+.
  const [extraVehicles, setExtraVehicles] = useState<ExtraVehicleDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The critical rule: the button lights up instantly with just a name.
  const isFormValid = customerName.trim().length > 0;

  const addExtraVehicleRow = () => setExtraVehicles((prev) => [...prev, blankExtraVehicle()]);
  const removeExtraVehicleRow = (key: number) =>
    setExtraVehicles((prev) => prev.filter((v) => v.key !== key));
  const patchExtraVehicle = (key: number, patch: Partial<ExtraVehicleDraft>) =>
    setExtraVehicles((prev) => prev.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  const submit = async () => {
    if (!isFormValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const lead = await createQuickLead({
        customerName,
        phone,
        address,
        vehicleMake,
        damageType,
      });
      // Best-effort, sequential — there are only ever a handful of these; a
      // failed row falls back to the local store the same as the lead itself.
      const savedVehicles: LeadVehicle[] = [];
      for (const v of extraVehicles) {
        if (!v.make.trim() && !v.model.trim() && !v.vin.trim() && !v.year.trim()) continue;
        savedVehicles.push(
          await addLeadVehicle(lead.id, {
            vehicleYear: v.year.trim() ? parseInt(v.year, 10) : undefined,
            vehicleMake: v.make.trim() || undefined,
            vehicleModel: v.model.trim() || undefined,
            vin: v.vin.trim() || undefined,
            severity: v.severity,
          }),
        );
      }
      // Attach here too — createQuickLead() returned before these existed,
      // so the board update from onComplete needs them added back on for
      // the "+N more vehicles" badge to show without a full refetch.
      onComplete(savedVehicles.length > 0 ? { ...lead, additionalVehicles: savedVehicles } : lead);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save lead.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500';
  const labelCls = 'mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-400';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Quick porch capture"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-100 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold tracking-tight">⚡ Quick Porch Capture</h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4"
        >
          <div>
            <label className={labelCls}>Customer Name *</label>
            <input
              type="text"
              required
              autoFocus
              placeholder="e.g. John Doe"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Phone Number</label>
              <input
                type="tel"
                placeholder="(555) 000-0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Vehicle Make</label>
              <input
                type="text"
                placeholder="e.g. Ford F-150"
                value={vehicleMake}
                onChange={(e) => setVehicleMake(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Street Address / Property Pin</label>
            <input
              type="text"
              placeholder="123 Maple Street"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>Damage Type</label>
            <select
              value={damageType}
              onChange={(e) => setDamageType(e.target.value as DamageType)}
              className={inputCls}
            >
              {DAMAGE_TYPES.map((t) => (
                <option key={t} value={t} className="bg-zinc-900">
                  {DAMAGE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="border-t border-zinc-800 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Additional Vehicles {extraVehicles.length > 0 && `(${extraVehicles.length})`}
              </span>
              <button
                type="button"
                onClick={addExtraVehicleRow}
                className="text-xs font-semibold text-sky-400 hover:text-sky-300"
              >
                + Add vehicle
              </button>
            </div>
            <p className="mb-2 text-[11px] text-zinc-500">
              More than one vehicle damaged at this property? Add each one here.
            </p>
            {extraVehicles.length > 0 && (
              <div className="space-y-2">
                {extraVehicles.map((v) => (
                  <div key={v.key} className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-2">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-zinc-400">Vehicle</span>
                      <button
                        type="button"
                        onClick={() => removeExtraVehicleRow(v.key)}
                        aria-label="Remove vehicle"
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        ✕ Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Year"
                        value={v.year}
                        onChange={(e) => patchExtraVehicle(v.key, { year: e.target.value })}
                        className={inputCls}
                      />
                      <input
                        type="text"
                        placeholder="Make"
                        value={v.make}
                        onChange={(e) => patchExtraVehicle(v.key, { make: e.target.value })}
                        className={inputCls}
                      />
                      <input
                        type="text"
                        placeholder="Model"
                        value={v.model}
                        onChange={(e) => patchExtraVehicle(v.key, { model: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      <input
                        type="text"
                        placeholder="VIN"
                        value={v.vin}
                        onChange={(e) => patchExtraVehicle(v.key, { vin: e.target.value })}
                        className={inputCls}
                      />
                      <select
                        value={v.severity}
                        onChange={(e) =>
                          patchExtraVehicle(v.key, { severity: e.target.value as StormSeverity })
                        }
                        className={inputCls}
                      >
                        {STORM_SEVERITY_ORDER.map((s) => (
                          <option key={s} value={s} className="bg-zinc-900">
                            {STORM_SEVERITY_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isFormValid || submitting}
              className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white transition-all hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? 'Saving…' : 'Save Quick Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
