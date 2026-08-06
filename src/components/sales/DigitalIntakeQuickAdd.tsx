'use client';

/**
 * DigitalIntakeQuickAdd — lightweight web/social lead capture for the Digital
 * Inbound & Storm Triage tab: storm zip-code attribution, damage photo
 * upload, an instant severity rating, and the Catastrophe Legal & Carrier
 * Intelligence Shield's mandatory document vault + policyholder identity
 * split. Deliberately not the full mobile-intake wizard (no on-site
 * signature) — AOB execution happens later, either in person or via the
 * Remote AOB Secure Signing Link dispatched here when the intake contact
 * isn't the Named Insured.
 */
import { useState } from 'react';
import { clsx } from 'clsx';
import { createDigitalLead } from '@/lib/sales-db';
import { importEstimateLineItems } from '@/lib/ops-db';
import { parseEstimate } from '@/lib/estimate-parser';
import { getCarrierIntel, CHECKLIST_ITEM_LABEL, type ChecklistItemId } from '@/lib/carrier-intel';
import {
  STORM_SEVERITY_LABEL,
  STORM_SEVERITY_ORDER,
  type IntakeDocKind,
  type IntakeLead,
  type PendingVehicleDocument,
  type ProxyPolicyholder,
  type StormSeverity,
} from '@/components/sales/types';
import type { PartsLineItem } from '@/components/ops/types';

interface DigitalIntakeQuickAddProps {
  onClose: () => void;
  onComplete: (lead: IntakeLead) => void;
}

const SEVERITY_TONE: Record<StormSeverity, string> = {
  MINOR: 'border-zinc-600 text-zinc-300',
  MODERATE: 'border-amber-500 text-amber-300',
  SEVERE: 'border-orange-500 text-orange-300',
  CATASTROPHIC: 'border-red-500 text-red-300',
};

const RISK_TONE: Record<'LOW' | 'MODERATE' | 'HIGH', string> = {
  LOW: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  MODERATE: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  HIGH: 'border-red-500/40 bg-red-500/10 text-red-200',
};

const VAULT_SLOTS: { kind: Extract<IntakeDocKind, 'DL_FRONT' | 'DL_BACK' | 'INSURANCE_CARD'>; label: string }[] = [
  { kind: 'DL_FRONT', label: "Driver's License — Front" },
  { kind: 'DL_BACK', label: "Driver's License — Back" },
  { kind: 'INSURANCE_CARD', label: 'Insurance Card' },
];

export function DigitalIntakeQuickAdd({ onClose, onComplete }: DigitalIntakeQuickAddProps) {
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [stormTag, setStormTag] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [insuranceCarrier, setInsuranceCarrier] = useState('');
  const [claimNumber, setClaimNumber] = useState('');
  const [estimatedAmount, setEstimatedAmount] = useState('');
  const [severity, setSeverity] = useState<StormSeverity>('MODERATE');
  const [photos, setPhotos] = useState<PendingVehicleDocument[]>([]);

  // Document Vault (mandatory intake grid)
  const [vaultDocs, setVaultDocs] = useState<Partial<Record<IntakeDocKind, PendingVehicleDocument>>>({});
  const [parsedItems, setParsedItems] = useState<PartsLineItem[]>([]);
  const [parseMsg, setParseMsg] = useState<string | null>(null);

  // Policyholder Identity Split & Proxy Sign-off
  const [policyholderMatch, setPolicyholderMatch] = useState(true);
  const [proxyFullName, setProxyFullName] = useState('');
  const [proxyRelationship, setProxyRelationship] = useState('');
  const [proxyPhone, setProxyPhone] = useState('');
  const [proxyEmail, setProxyEmail] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const carrierIntel = getCarrierIntel(insuranceCarrier);
  const carrierChecklist: ChecklistItemId[] = carrierIntel.requiredChecklist;

  const handlePhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const refs: PendingVehicleDocument[] = Array.from(files).map((file) => ({
      kind: 'DAMAGE_PHOTO',
      file,
      fileName: file.name,
    }));
    setPhotos((prev) => [...prev, ...refs]);
  };

  const setVaultDoc = (kind: IntakeDocKind, file: File | undefined) => {
    if (!file) return;
    setVaultDocs((prev) => ({ ...prev, [kind]: { kind, file, fileName: file.name } }));
  };

  const onEstimateFile = async (file: File | undefined) => {
    if (!file) return;
    setVaultDocs((prev) => ({ ...prev, PRIOR_ESTIMATE: { kind: 'PRIOR_ESTIMATE', file, fileName: file.name } }));
    try {
      const text = await file.text();
      const items = parseEstimate(text);
      setParsedItems(items);
      if (items.length > 0) {
        const sum = items.reduce((s, i) => s + (i.unitCost ?? 0) * (i.quantity ?? 1), 0);
        if (sum > 0) setEstimatedAmount(String(Math.round(sum)));
        setParseMsg(`Extracted ${items.length} line item${items.length === 1 ? '' : 's'} from estimate.`);
      } else {
        setParseMsg('Could not auto-extract line items — file stored for reference.');
      }
    } catch {
      setParseMsg('Could not read file.');
    }
  };

  // Driver's License, Insurance Card, and Prior Estimate are optional — a
  // rep can push the lead forward instantly and fill them in later. The
  // dynamic carrier-risk checklist stays mandatory (compliance gate).
  const checklistComplete = carrierChecklist.every((kind) => Boolean(vaultDocs[kind]));
  const proxyComplete = policyholderMatch || proxyFullName.trim() !== '';
  const canSubmit = customerName.trim() !== '' && checklistComplete && proxyComplete;

  const submit = async () => {
    if (!customerName.trim()) {
      setError('Customer name is required.');
      return;
    }
    if (!checklistComplete) {
      setError('This carrier requires additional documentation before the lead can be created.');
      return;
    }
    if (!proxyComplete) {
      setError('Proxy policyholder full name is required when Policyholder Match is No.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const documents: PendingVehicleDocument[] = [...Object.values(vaultDocs), ...photos];
      const proxyPolicyholder: ProxyPolicyholder | null = policyholderMatch
        ? null
        : {
            fullName: proxyFullName.trim(),
            relationship: proxyRelationship.trim(),
            phone: proxyPhone.trim(),
            email: proxyEmail.trim(),
          };

      const lead = await createDigitalLead({
        customerName: customerName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        vehicleYear: Number(vehicleYear) || 0,
        vehicleMake: vehicleMake.trim(),
        vehicleModel: vehicleModel.trim(),
        insuranceCarrier: insuranceCarrier.trim(),
        claimNumber: claimNumber.trim(),
        estimatedAmount: Number(estimatedAmount) || 0,
        stormTag: stormTag.trim(),
        zipCode: zipCode.trim(),
        severity,
        documents,
        policyholderMatch,
        proxyPolicyholder,
      });

      // Bind the initial insurance estimate to the supplement audit data
      // pipeline — best-effort; a parse/import failure never blocks intake.
      if (parsedItems.length > 0 && claimNumber.trim()) {
        try {
          await importEstimateLineItems(claimNumber.trim(), parsedItems);
        } catch (err) {
          console.warn('[DigitalIntakeQuickAdd] estimate import failed:', err);
        }
      }

      // Remote AOB Execution Gate: dispatch the secure signing link when the
      // intake contact isn't the Named Insured. Best-effort.
      let finalLead = lead;
      if (proxyPolicyholder) {
        try {
          const res = await fetch(`/api/v1/sales/leads/${lead.id}/remote-aob`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proxy: proxyPolicyholder }),
          });
          if (!res.ok) throw new Error(`Dispatch failed (${res.status})`);
          const { token } = (await res.json()) as { token: string };
          finalLead = { ...lead, remoteAobStatus: 'SENT', remoteAobToken: token };
        } catch (err) {
          console.warn('[DigitalIntakeQuickAdd] remote AOB dispatch failed:', err);
        }
      }

      onComplete(finalLead);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create lead.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1.5 text-sm text-zinc-100 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40';
  const labelCls = 'mb-1 block text-xs font-medium text-zinc-400';
  const fileCls =
    'block w-full text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-zinc-200';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add new lead"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-zinc-100">Add New Lead</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className={labelCls}>Customer name</label>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-2">
            <div>
              <label className={labelCls}>Storm zip code</label>
              <input value={zipCode} onChange={(e) => setZipCode(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Storm / campaign tag</label>
              <input
                value={stormTag}
                onChange={(e) => setStormTag(e.target.value)}
                placeholder="e.g. HAIL-0724"
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Instant severity rating</label>
            <div className="grid grid-cols-4 gap-1.5">
              {STORM_SEVERITY_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={clsx(
                    'rounded-md border px-1.5 py-1.5 text-[11px] font-semibold transition-colors',
                    severity === s ? SEVERITY_TONE[s] : 'border-zinc-700 text-zinc-500 hover:text-zinc-300',
                  )}
                >
                  {STORM_SEVERITY_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Damage photos</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => void handlePhotos(e.target.files)}
              className="w-full text-xs text-zinc-400 file:mr-2 file:rounded-md file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-xs file:text-zinc-200"
            />
            {photos.length > 0 && (
              <p className="mt-1 text-[11px] text-emerald-300">{photos.length} photo(s) attached</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={labelCls}>Year</label>
              <input
                value={vehicleYear}
                onChange={(e) => setVehicleYear(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Make</label>
              <input
                value={vehicleMake}
                onChange={(e) => setVehicleMake(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Model</label>
              <input
                value={vehicleModel}
                onChange={(e) => setVehicleModel(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Insurance carrier</label>
              <input
                value={insuranceCarrier}
                onChange={(e) => setInsuranceCarrier(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Claim number</label>
              <input
                value={claimNumber}
                onChange={(e) => setClaimNumber(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {insuranceCarrier.trim() && (
            <div className={clsx('rounded-md border px-2 py-1 text-[11px] font-medium', RISK_TONE[carrierIntel.riskProfile])}>
              {carrierIntel.lowballFlag ? '⚠ Lowball risk' : 'Standard risk'} · {carrierIntel.riskProfile}
              {carrierIntel.supplementFlag && ' · Expect supplement'}
            </div>
          )}

          <div>
            <label className={labelCls}>Estimated amount</label>
            <input
              value={estimatedAmount}
              onChange={(e) => setEstimatedAmount(e.target.value)}
              className={inputCls}
            />
          </div>

          <div className="space-y-2 border-t border-zinc-800 pt-3">
            <p className="text-[11px] text-zinc-500">
              Document Vault — Driver&apos;s License, Insurance Card, and Initial Estimate are
              optional here; capture them now or follow up later to push the lead forward instantly.
            </p>
            {VAULT_SLOTS.map((slot) => (
              <label key={slot.kind} className="block">
                <span className={labelCls}>{slot.label}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => void setVaultDoc(slot.kind, e.target.files?.[0])}
                  className={fileCls}
                />
                {vaultDocs[slot.kind] ? (
                  <span className="mt-0.5 block truncate text-[11px] text-emerald-300">
                    ✓ {vaultDocs[slot.kind]?.fileName}
                  </span>
                ) : (
                  <span className="mt-0.5 inline-flex rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                    {slot.label}: Pending
                  </span>
                )}
              </label>
            ))}

            <label className="block">
              <span className={labelCls}>Initial Insurance Estimate</span>
              <input
                type="file"
                accept=".json,.xml,.csv,.txt"
                onChange={(e) => void onEstimateFile(e.target.files?.[0])}
                className={fileCls}
              />
              {parseMsg && <span className="mt-1 block text-[11px] text-sky-300">{parseMsg}</span>}
              {vaultDocs.PRIOR_ESTIMATE ? (
                <span className="mt-0.5 block truncate text-[11px] text-emerald-300">
                  ✓ {vaultDocs.PRIOR_ESTIMATE.fileName}
                </span>
              ) : (
                <span className="mt-0.5 inline-flex rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                  Initial Estimate: Pending
                </span>
              )}
            </label>
          </div>

          {carrierChecklist.length > 0 && (
            <div className="space-y-2 border-t border-amber-500/20 bg-amber-500/5 p-2 pt-3">
              <p className="font-mono text-[11px] uppercase tracking-wider text-amber-300">
                Carrier-Required Documentation
              </p>
              <p className="text-[11px] text-zinc-500">
                {insuranceCarrier || 'This carrier'} flags claims for scrutiny — capture these before
                proceeding.
              </p>
              {carrierChecklist.map((kind) => (
                <label key={kind} className="block">
                  <span className={labelCls}>
                    {CHECKLIST_ITEM_LABEL[kind]} <span className="text-red-400">*</span>
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => void setVaultDoc(kind, e.target.files?.[0])}
                    className={fileCls}
                  />
                  {vaultDocs[kind] && (
                    <span className="mt-0.5 block truncate text-[11px] text-emerald-300">
                      ✓ {vaultDocs[kind]?.fileName}
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}

          <div className="border-t border-zinc-800 pt-3">
            <span className="mb-1.5 block text-xs font-medium text-zinc-400">
              Named Insured / Policyholder Match
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setPolicyholderMatch(true)}
                aria-pressed={policyholderMatch}
                className={clsx(
                  'rounded-md border px-2 py-1.5 text-xs font-semibold',
                  policyholderMatch
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                    : 'border-zinc-700 text-zinc-500 hover:text-zinc-300',
                )}
              >
                Yes — matches policy
              </button>
              <button
                type="button"
                onClick={() => setPolicyholderMatch(false)}
                aria-pressed={!policyholderMatch}
                className={clsx(
                  'rounded-md border px-2 py-1.5 text-xs font-semibold',
                  !policyholderMatch
                    ? 'border-amber-500/60 bg-amber-500/15 text-amber-200'
                    : 'border-zinc-700 text-zinc-500 hover:text-zinc-300',
                )}
              >
                No — off-site proxy
              </button>
            </div>

            {!policyholderMatch && (
              <div className="mt-2 space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                <p className="text-[11px] text-amber-200">
                  A Remote AOB Secure Signing Link will be emailed to the proxy below.
                </p>
                <input
                  className={inputCls}
                  placeholder="Proxy full name *"
                  value={proxyFullName}
                  onChange={(e) => setProxyFullName(e.target.value)}
                />
                <input
                  className={inputCls}
                  placeholder="Relationship to policyholder"
                  value={proxyRelationship}
                  onChange={(e) => setProxyRelationship(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className={inputCls}
                    placeholder="Proxy phone"
                    value={proxyPhone}
                    onChange={(e) => setProxyPhone(e.target.value)}
                  />
                  <input
                    className={inputCls}
                    placeholder="Proxy email"
                    value={proxyEmail}
                    onChange={(e) => setProxyEmail(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !canSubmit}
            onClick={() => void submit()}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create lead'}
          </button>
        </div>
      </div>
    </div>
  );
}
