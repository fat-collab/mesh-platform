'use client';

/**
 * LeadDetailDrawer — opens from a lead card on the Sales board so a rep can
 * correct a saved lead's details and capture documents that were missing at
 * intake, without redoing the whole MobileIntakeWizard. The carrier-required
 * checklist here is display + capture only — convertLeadToRO is still the
 * one place that gate is actually enforced (see sales-db.ts).
 *
 * Field-first: every field is optional to edit and to save. Nothing here
 * blocks a save because a value looks incomplete.
 */
import { useEffect, useState } from 'react';
import {
  updateLeadDetails,
  addLeadDocument,
  removeLeadDocument,
  assignLeadStaff,
  type LeadDetailsPatch,
} from '@/lib/sales-db';
import { getCurrentProfile } from '@/lib/auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getCarrierIntel, CHECKLIST_ITEM_LABEL } from '@/lib/carrier-intel';
import {
  DAMAGE_TYPE_LABEL,
  type DamageType,
  type IntakeDocKind,
  type IntakeDocumentRef,
  type IntakeLead,
} from '@/components/sales/types';
import type { UserRole } from '@/lib/database.types';

const DAMAGE_TYPES: DamageType[] = ['Collision', 'Hail', 'Dent', 'Glass'];

// The rest of IntakeDocKind, beyond the carrier-checklist-eligible subset
// (ChecklistItemId, from carrier-intel.ts) — general document capture, never
// gating. Labels match MobileIntakeWizard's DOC_SLOTS where it defines one.
const GENERAL_DOC_KINDS: IntakeDocKind[] = [
  'DL_FRONT',
  'DL_BACK',
  'INSURANCE_CARD',
  'PRIOR_ESTIMATE',
  'WALKAROUND',
  'DAMAGE_PHOTO',
];
const GENERAL_DOC_LABEL: Record<string, string> = {
  DL_FRONT: "Driver's License — Front",
  DL_BACK: "Driver's License — Back",
  INSURANCE_CARD: 'Insurance Card',
  PRIOR_ESTIMATE: 'Prior Estimate / Carrier Sheet',
  WALKAROUND: 'Walkaround Photo',
  DAMAGE_PHOTO: 'Damage Photo',
};

interface LeadDetailDrawerProps {
  lead: IntakeLead;
  onClose: () => void;
  /** Called with the merged, post-save lead so the board can update in
   *  place — no refetch required (see the report on this). */
  onSaved: (lead: IntakeLead) => void;
}

export function LeadDetailDrawer({ lead, onClose, onSaved }: LeadDetailDrawerProps) {
  const [customerName, setCustomerName] = useState(lead.customerName);
  const [phone, setPhone] = useState(lead.phone);
  const [email, setEmail] = useState(lead.email);
  const [address, setAddress] = useState(lead.address ?? '');
  const [vehicleYear, setVehicleYear] = useState(lead.vehicleYear ? String(lead.vehicleYear) : '');
  const [vehicleMake, setVehicleMake] = useState(lead.vehicleMake);
  const [vehicleModel, setVehicleModel] = useState(lead.vehicleModel);
  const [vinLast8, setVinLast8] = useState(lead.vinLast8);
  const [insuranceCarrier, setInsuranceCarrier] = useState(lead.insuranceCarrier);
  const [claimNumber, setClaimNumber] = useState(lead.claimNumber);
  const [damageType, setDamageType] = useState<DamageType | ''>(lead.damageType ?? '');
  const [estimatedAmount, setEstimatedAmount] = useState(
    lead.estimatedAmount ? String(lead.estimatedAmount) : '',
  );

  const [documents, setDocuments] = useState<IntakeDocumentRef[]>(lead.documents ?? []);
  const [ownerName, setOwnerName] = useState(lead.assignedStaffName ?? '');
  const [ownerEditing, setOwnerEditing] = useState(false);
  const [ownerDraft, setOwnerDraft] = useState(ownerName);
  const [role, setRole] = useState<UserRole | null>(null);

  const [saving, setSaving] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getCurrentProfile(getSupabaseBrowserClient());
        if (!cancelled) setRole(profile?.role ?? null);
      } catch {
        /* no session — owner stays read-only, the safe default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const canReassignOwner = role === 'MANAGER' || role === 'EXECUTIVE';

  // Live re-evaluation: driven by the in-progress insuranceCarrier edit, not
  // the original lead prop, so changing the carrier updates the checklist
  // before Save is ever clicked.
  const carrierChecklist = getCarrierIntel(insuranceCarrier).requiredChecklist;

  const commitOwner = async () => {
    const next = ownerDraft.trim();
    if (next === ownerName.trim()) {
      setOwnerEditing(false);
      return;
    }
    try {
      await assignLeadStaff(lead.id, next || null);
      setOwnerName(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reassign owner.');
    } finally {
      setOwnerEditing(false);
    }
  };

  const handleUpload = async (kind: IntakeDocKind, file: File | undefined) => {
    if (!file) return;
    setUploadingKind(kind);
    setError(null);
    try {
      const existing = documents.find((d) => d.kind === kind);
      if (existing) {
        await removeLeadDocument(lead.id, kind);
      }
      const updated = await addLeadDocument(lead.id, {
        kind,
        fileName: file.name,
        url: URL.createObjectURL(file),
      });
      setDocuments(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the document.');
    } finally {
      setUploadingKind(null);
    }
  };

  const handleRemove = async (kind: IntakeDocKind) => {
    setUploadingKind(kind);
    setError(null);
    try {
      const updated = await removeLeadDocument(lead.id, kind);
      setDocuments(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove the document.');
    } finally {
      setUploadingKind(null);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const patch: LeadDetailsPatch = {};
      if (customerName !== lead.customerName) patch.customerName = customerName;
      if (phone !== lead.phone) patch.phone = phone;
      if (email !== lead.email) patch.email = email;
      if (address !== (lead.address ?? '')) patch.address = address;
      const year = vehicleYear.trim() ? parseInt(vehicleYear, 10) : 0;
      if (year !== (lead.vehicleYear ?? 0)) patch.vehicleYear = year;
      if (vehicleMake !== lead.vehicleMake) patch.vehicleMake = vehicleMake;
      if (vehicleModel !== lead.vehicleModel) patch.vehicleModel = vehicleModel;
      if (vinLast8 !== lead.vinLast8) patch.vinLast8 = vinLast8;
      if (insuranceCarrier !== lead.insuranceCarrier) patch.insuranceCarrier = insuranceCarrier;
      if (claimNumber !== lead.claimNumber) patch.claimNumber = claimNumber;
      // damage_type has a DB CHECK constraint (specific values or NULL) — an
      // empty string would violate it, so clearing back to "—" is not sent;
      // only an actual selected value patches this field.
      if (damageType && damageType !== lead.damageType) {
        patch.damageType = damageType;
      }
      const amount = estimatedAmount.trim() ? parseFloat(estimatedAmount) : 0;
      if (amount !== (lead.estimatedAmount ?? 0)) patch.estimatedAmount = amount;

      await updateLeadDetails(lead.id, patch);

      onSaved({
        ...lead,
        ...patch,
        assignedStaffName: ownerName || undefined,
        documents,
      });
    } catch (err) {
      setError(
        `⚠ Could not save this lead's details (${
          err instanceof Error ? err.message : 'unknown error'
        }). Please retry.`,
      );
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500';
  const labelCls = 'mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-400';

  // Shared row for both the gating (carrier-checklist) and non-gating
  // (general) document sections — same interaction, different color
  // language so the gating status stays visually distinct: red/amber only
  // ever appears for checklist items; general items use neutral zinc.
  function renderDocSlot(kind: IntakeDocKind, label: string, gating: boolean) {
    const captured = documents.find((d) => d.kind === kind);
    const busy = uploadingKind === kind;
    return (
      <div key={kind} className="rounded-md border border-zinc-700 bg-zinc-800/60 p-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-zinc-300">{label}</span>
          {captured ? (
            <span className="text-[11px] font-semibold text-emerald-300">✓ Captured</span>
          ) : gating ? (
            <span className="text-[11px] font-semibold text-red-300">✗ Missing</span>
          ) : (
            <span className="text-[11px] font-medium text-zinc-500">— Not captured</span>
          )}
        </div>
        {captured && (
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="truncate text-[11px] text-zinc-500">{captured.fileName}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleRemove(kind)}
              className="shrink-0 text-[11px] font-semibold text-red-400 hover:text-red-300 disabled:opacity-40"
            >
              ✕ Remove
            </button>
          </div>
        )}
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e) => void handleUpload(kind, e.target.files?.[0])}
          className="block w-full text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-zinc-200"
        />
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Lead details"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 p-6 pb-4">
          <h3 className="text-lg font-bold tracking-tight">Lead Details</h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6 pt-4">
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          {/* --- Owner --- */}
          <div>
            <span className={labelCls}>Owner</span>
            {canReassignOwner ? (
              ownerEditing ? (
                <input
                  autoFocus
                  value={ownerDraft}
                  onChange={(e) => setOwnerDraft(e.target.value)}
                  onBlur={() => void commitOwner()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitOwner();
                    if (e.key === 'Escape') {
                      setOwnerDraft(ownerName);
                      setOwnerEditing(false);
                    }
                  }}
                  placeholder="Assign rep…"
                  className={inputCls}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setOwnerDraft(ownerName);
                    setOwnerEditing(true);
                  }}
                  className="flex w-full items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-left text-sm hover:border-zinc-600"
                  title="Reassign lead owner"
                >
                  <span aria-hidden>👤</span>
                  {ownerName ? (
                    <span>{ownerName}</span>
                  ) : (
                    <span className="italic text-amber-400/80">Unassigned</span>
                  )}
                </button>
              )
            ) : (
              <p className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
                <span aria-hidden>👤</span>
                {ownerName || <span className="italic text-amber-400/80">Unassigned</span>}
              </p>
            )}
          </div>

          {/* --- Customer --- */}
          <div>
            <label className={labelCls}>Customer name</label>
            <input className={inputCls} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Phone</label>
              <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Street address</label>
            <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>

          {/* --- Vehicle --- */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Year</label>
              <input
                className={inputCls}
                inputMode="numeric"
                value={vehicleYear}
                onChange={(e) => setVehicleYear(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Make</label>
              <input className={inputCls} value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Model</label>
              <input className={inputCls} value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelCls}>VIN (last 8)</label>
            <input
              className={inputCls}
              maxLength={8}
              value={vinLast8}
              onChange={(e) => setVinLast8(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Damage type</label>
            <select
              className={inputCls}
              value={damageType}
              onChange={(e) => setDamageType(e.target.value as DamageType | '')}
            >
              <option value="" className="bg-zinc-900">
                —
              </option>
              {DAMAGE_TYPES.map((t) => (
                <option key={t} value={t} className="bg-zinc-900">
                  {DAMAGE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>

          {/* --- Insurance / claim --- */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Insurance carrier</label>
              <input
                className={inputCls}
                value={insuranceCarrier}
                onChange={(e) => setInsuranceCarrier(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Claim #</label>
              <input className={inputCls} value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Estimated amount ($)</label>
            <input
              className={inputCls}
              inputMode="decimal"
              value={estimatedAmount}
              onChange={(e) => setEstimatedAmount(e.target.value)}
            />
          </div>

          {/* --- Carrier-required documentation (gating) --- */}
          {carrierChecklist.length > 0 && (
            <div className="space-y-2 border-t border-amber-500/20 bg-amber-500/5 p-3">
              <p className="font-mono text-[11px] uppercase tracking-wider text-amber-300">
                Carrier-Required Documentation
              </p>
              <p className="text-[11px] text-zinc-500">
                {insuranceCarrier || 'This carrier'} flags claims for scrutiny — capture these before
                converting to a repair order.
              </p>
              {carrierChecklist.map((kind) =>
                renderDocSlot(kind, CHECKLIST_ITEM_LABEL[kind], true),
              )}
            </div>
          )}

          {/* --- Other documents (not gating) --- */}
          <div className="space-y-2 border-t border-zinc-800 pt-3">
            <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
              Other Documents
            </p>
            <p className="text-[11px] text-zinc-500">
              Optional — fill in whatever was missed at intake. Never blocks saving or converting.
            </p>
            {GENERAL_DOC_KINDS.map((kind) =>
              renderDocSlot(kind, GENERAL_DOC_LABEL[kind], false),
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-zinc-800 p-6 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white transition-all hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
