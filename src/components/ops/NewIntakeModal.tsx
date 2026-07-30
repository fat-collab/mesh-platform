'use client';

/**
 * NewIntakeModal — manual Ops intake entry, with a "Pull from Sales" action
 * that lists converted leads and auto-populates vehicle, customer, and damage
 * notes from the lead's original intake submission. The parent persists on
 * create (DB when available, else the local board) and refreshes the board.
 */
import { useState } from 'react';
import { clsx } from 'clsx';
import { getConvertedLeadsForPull } from '@/lib/sales-db';
import type { IntakeLead } from '@/components/sales/types';

type PulledLead = IntakeLead & { damageNotes: string };

export interface NewIntakePayload {
  customerName: string;
  vehicle: string;
  vin: string;
  claimNumber: string;
  insuranceCarrier: string;
  intakeNotes: string;
}

export interface NewIntakeModalProps {
  onClose: () => void;
  onCreate: (payload: NewIntakePayload) => Promise<void> | void;
}

export function NewIntakeModal({ onClose, onCreate }: NewIntakeModalProps) {
  const [customerName, setCustomerName] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [vin, setVin] = useState('');
  const [claimNumber, setClaimNumber] = useState('');
  const [insuranceCarrier, setInsuranceCarrier] = useState('');
  const [intakeNotes, setIntakeNotes] = useState('');

  const [pullOpen, setPullOpen] = useState(false);
  const [pullLoading, setPullLoading] = useState(false);
  const [pullResults, setPullResults] = useState<PulledLead[] | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPullFromSales = async () => {
    setPullOpen(true);
    if (pullResults) return;
    setPullLoading(true);
    try {
      setPullResults(await getConvertedLeadsForPull());
    } finally {
      setPullLoading(false);
    }
  };

  const applyLead = (lead: PulledLead) => {
    setCustomerName(lead.customerName);
    setVehicle(`${lead.vehicleYear} ${lead.vehicleMake} ${lead.vehicleModel}`.trim());
    setVin(lead.vinLast8 || '');
    setClaimNumber(lead.claimNumber || '');
    setInsuranceCarrier(lead.insuranceCarrier || '');
    setIntakeNotes(lead.damageNotes || '');
    setPullOpen(false);
  };

  const handleSave = async () => {
    if (saving) return;
    if (!customerName.trim() || !vehicle.trim()) {
      setError('Customer name and vehicle are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        customerName: customerName.trim(),
        vehicle: vehicle.trim(),
        vin: vin.trim(),
        claimNumber: claimNumber.trim(),
        insuranceCarrier: insuranceCarrier.trim(),
        intakeNotes: intakeNotes.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create intake.');
    } finally {
      setSaving(false);
    }
  };

  const input =
    'w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40';
  const labelCls = 'mb-1 block font-mono text-[11px] uppercase tracking-wider text-zinc-500';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="New Ops intake"
      onClick={() => !saving && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 p-4">
          <h2 className="text-base font-bold text-zinc-100">New Repair Order Intake</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-4">
          <button
            type="button"
            onClick={() => void openPullFromSales()}
            className="w-full rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm font-semibold text-sky-200 transition-colors hover:bg-sky-500/20"
          >
            ⇩ Pull from Sales
          </button>

          {pullOpen && (
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
              {pullLoading ? (
                <p className="p-2 text-xs text-zinc-500">Loading converted leads…</p>
              ) : !pullResults || pullResults.length === 0 ? (
                <p className="p-2 text-xs text-zinc-500">No converted leads available to pull.</p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {pullResults.map((lead) => (
                    <li key={lead.id}>
                      <button
                        type="button"
                        onClick={() => applyLead(lead)}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-zinc-800/70"
                      >
                        <span className="min-w-0 truncate text-zinc-200">{lead.customerName}</span>
                        <span className="shrink-0 text-zinc-500">
                          {lead.vehicleYear} {lead.vehicleMake} {lead.vehicleModel}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <label className="block">
            <span className={labelCls}>Customer name *</span>
            <input className={input} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </label>

          <label className="block">
            <span className={labelCls}>Vehicle *</span>
            <input
              className={input}
              placeholder="2021 Ford F-150"
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={labelCls}>VIN (last 8)</span>
              <input className={input} value={vin} onChange={(e) => setVin(e.target.value)} />
            </label>
            <label className="block">
              <span className={labelCls}>Claim #</span>
              <input className={input} value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} />
            </label>
          </div>

          <label className="block">
            <span className={labelCls}>Insurance carrier</span>
            <input className={input} value={insuranceCarrier} onChange={(e) => setInsuranceCarrier(e.target.value)} />
          </label>

          <label className="block">
            <span className={labelCls}>Damage / condition notes</span>
            <textarea
              className={clsx(input, 'resize-none')}
              rows={3}
              value={intakeNotes}
              onChange={(e) => setIntakeNotes(e.target.value)}
            />
          </label>

          {error && (
            <p className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-xs text-red-200">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create Intake'}
          </button>
        </div>
      </div>
    </div>
  );
}
