'use client';

/**
 * MobileIntakeWizard — 5-step mobile field intake for PDR / auto-hail leads.
 *
 * Steps: (1) customer & vehicle quick info, (2) document capture (DL, insurance
 * card, prior estimate → parsed via estimate-parser), (3) pre-damage walkaround
 * + panel hail-severity matrix, (4) specialized PDR/hail service agreement with
 * an HTML5 canvas e-signature, (5) submit → persists the intake package and
 * creates an active lead via sales-db.
 */
import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { parseEstimate } from '@/lib/estimate-parser';
import { saveIntakePackage } from '@/lib/sales-db';
import { assignVehicle, getAvailableVehicles } from '@/lib/rental-db';
import { getCurrentProfile } from '@/lib/auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { CarrierTierBadge } from '@/components/carrier/CarrierTierBadge';
import type { PartsLineItem } from '@/components/ops/types';
import type {
  HailPanelAssessment,
  HailSeverity,
  IntakeDocKind,
  IntakeDocumentRef,
  IntakeLead,
  IntakeSubmission,
  RentalAssignmentInfo,
  RentalVehicle,
  WalkaroundItem,
} from './types';

// --- signature pad ----------------------------------------------------------

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (c.width / r.width),
      y: (e.clientY - r.top) * (c.height / r.height),
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current;
    if (!c) return;
    c.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#e4e4e7';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    dirty.current = true;
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current && ref.current) onChange(ref.current.toDataURL('image/png'));
  };

  const clear = () => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  };

  return (
    <div className="space-y-1.5">
      <canvas
        ref={ref}
        width={560}
        height={180}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-40 w-full touch-none rounded-md border border-zinc-600 bg-zinc-950"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-500">Sign above with finger or stylus</span>
        <button
          type="button"
          onClick={clear}
          className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

// --- config -----------------------------------------------------------------

const HAIL_PANELS = ['Roof', 'Hood', 'Trunk', 'Fenders', 'Doors', 'Pillars'] as const;
const HAIL_SEVERITIES: HailSeverity[] = ['NONE', 'LIGHT', 'MODERATE', 'SEVERE'];

const SEVERITY_TONE: Record<HailSeverity, string> = {
  NONE: 'border-zinc-700 bg-zinc-800/50 text-zinc-400',
  LIGHT: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  MODERATE: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  SEVERE: 'border-red-500/50 bg-red-500/15 text-red-200',
};

const INITIAL_WALKAROUND: WalkaroundItem[] = [
  { id: 'scratches', label: 'Pre-existing body scratches', flagged: false },
  { id: 'glass_chips', label: 'Glass chips / cracks', flagged: false },
  { id: 'prior_repairs', label: 'Evidence of prior repairs / repaint', flagged: false },
  { id: 'rust', label: 'Rust / corrosion', flagged: false },
];

const DOC_SLOTS: { kind: IntakeDocKind; label: string; image: boolean }[] = [
  { kind: 'DL_FRONT', label: "Driver's License — Front", image: true },
  { kind: 'DL_BACK', label: "Driver's License — Back", image: true },
  { kind: 'INSURANCE_CARD', label: 'Insurance Card', image: true },
];

const STEP_TITLES = [
  'Customer & Vehicle',
  'Document Capture',
  'Walkaround & Hail Matrix',
  'Loaner / Rental',
  'Service Agreement',
  'Review & Submit',
];

const TOTAL_STEPS = STEP_TITLES.length;

export interface MobileIntakeWizardProps {
  onClose: () => void;
  onComplete: (lead: IntakeLead) => void;
}

export function MobileIntakeWizard({ onClose, onComplete }: MobileIntakeWizardProps) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  // Step 1
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vinLast8, setVinLast8] = useState('');
  const [claimNumber, setClaimNumber] = useState('');
  const [insuranceCarrier, setInsuranceCarrier] = useState('');
  // Accountability: the rep who owns this lead. Defaults to the signed-in user.
  const [assignedStaffName, setAssignedStaffName] = useState('');
  const [assignedStaffId, setAssignedStaffId] = useState<string | undefined>(undefined);

  // Step 2
  const [policyNumber, setPolicyNumber] = useState('');
  const [estimatedAmount, setEstimatedAmount] = useState('');
  const [docs, setDocs] = useState<Record<IntakeDocKind, IntakeDocumentRef | null>>({
    DL_FRONT: null,
    DL_BACK: null,
    INSURANCE_CARD: null,
    PRIOR_ESTIMATE: null,
    WALKAROUND: null,
  });
  const [parsedItems, setParsedItems] = useState<PartsLineItem[]>([]);
  const [parseMsg, setParseMsg] = useState<string | null>(null);

  // Step 3
  const [walkaround, setWalkaround] = useState<WalkaroundItem[]>(INITIAL_WALKAROUND);
  const [hail, setHail] = useState<Record<string, HailSeverity>>(
    Object.fromEntries(HAIL_PANELS.map((p) => [p, 'NONE'])) as Record<string, HailSeverity>,
  );
  const [conditionNotes, setConditionNotes] = useState('');
  const [walkaroundPhotos, setWalkaroundPhotos] = useState<IntakeDocumentRef[]>([]);

  // Step 4 — loaner / rental
  const [provideLoaner, setProvideLoaner] = useState(false);
  const [availableFleet, setAvailableFleet] = useState<RentalVehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [loanerStartMileage, setLoanerStartMileage] = useState('');
  const [loanerFuel, setLoanerFuel] = useState('');
  const [loanerPreDamage, setLoanerPreDamage] = useState('');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const [loanerAgent, setLoanerAgent] = useState('');

  // Step 5 — agreement + signature
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const units = await getAvailableVehicles();
      if (!cancelled) setAvailableFleet(units);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Default the lead owner to the signed-in rep so accountability is captured
  // the moment the intake is taken. The rep can override in Step 1.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getCurrentProfile(getSupabaseBrowserClient());
        if (cancelled || !profile) return;
        setAssignedStaffId(profile.authUserId);
        setAssignedStaffName((prev) => prev || profile.email || '');
      } catch {
        /* no session — leave owner blank for manual entry */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectVehicle = (v: RentalVehicle) => {
    setSelectedVehicleId(v.id);
    setLoanerStartMileage(String(v.currentMileage));
    setLoanerFuel(String(v.fuelLevel));
  };

  const input =
    'w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40';

  const setDoc = (kind: IntakeDocKind, file: File | undefined) => {
    if (!file) return;
    setDocs((prev) => ({
      ...prev,
      [kind]: { kind, fileName: file.name, url: URL.createObjectURL(file) },
    }));
  };

  const onEstimateFile = async (file: File | undefined) => {
    if (!file) return;
    setDoc('PRIOR_ESTIMATE', file);
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

  const toggleWalk = (id: string) =>
    setWalkaround((prev) => prev.map((w) => (w.id === id ? { ...w, flagged: !w.flagged } : w)));

  const addWalkaroundPhotos = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added: IntakeDocumentRef[] = Array.from(files).map((f) => ({
      kind: 'WALKAROUND',
      fileName: f.name,
      url: URL.createObjectURL(f),
    }));
    setWalkaroundPhotos((prev) => [...prev, ...added]);
  };
  const removeWalkaroundPhoto = (url: string | null | undefined) =>
    setWalkaroundPhotos((prev) => prev.filter((p) => p.url !== url));

  // Stage-1 OCR: post a captured document to the vision service and autofill.
  const scanDocument = async (file: File | undefined, docType: 'VIN' | 'INSURANCE') => {
    if (!file) return;
    setScanMsg('Scanning document…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('docType', docType);
      const res = await fetch('/api/v1/vision/ocr', { method: 'POST', body: fd });
      const json = (await res.json()) as {
        success?: boolean;
        data?: Record<string, unknown>;
        provider?: string;
      };
      if (!json.success || !json.data) {
        setScanMsg('Could not read document — please enter details manually.');
        return;
      }
      const d = json.data;
      const src = json.provider === 'mock' ? 'sample OCR' : 'OCR';
      if (docType === 'VIN') {
        if (typeof d.year === 'number') setVehicleYear(String(d.year));
        if (typeof d.make === 'string') setVehicleMake(d.make);
        if (typeof d.model === 'string') setVehicleModel(d.model);
        if (typeof d.vinLast8 === 'string') setVinLast8(d.vinLast8);
        setScanMsg(`✓ Autofilled vehicle from VIN (${src}).`);
      } else {
        if (typeof d.carrier === 'string') setInsuranceCarrier(d.carrier);
        if (typeof d.policyNumber === 'string') setPolicyNumber(d.policyNumber);
        if (typeof d.claimNumber === 'string' && d.claimNumber) setClaimNumber(d.claimNumber);
        if (typeof d.customerName === 'string' && d.customerName && !customerName) {
          setCustomerName(d.customerName);
        }
        setScanMsg(`✓ Autofilled insurance from card (${src}).`);
      }
    } catch {
      setScanMsg('Scan failed — please enter details manually.');
    }
  };

  const canProceed = (): boolean => {
    if (step === 1) return customerName.trim() !== '' && phone.trim() !== '';
    if (step === 4) return !provideLoaner || selectedVehicleId !== null;
    if (step === 5) return signatureDataUrl !== null && agreed;
    return true;
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const documents = (Object.keys(docs) as IntakeDocKind[])
        .map((k) => docs[k])
        .filter((d): d is IntakeDocumentRef => d !== null)
        .concat(walkaroundPhotos);
      const hailMatrix: HailPanelAssessment[] = HAIL_PANELS.map((panel) => ({
        panel,
        severity: hail[panel],
      }));

      const selectedVehicle = availableFleet.find((v) => v.id === selectedVehicleId);
      const rental: RentalAssignmentInfo | null =
        provideLoaner && selectedVehicle
          ? {
              vehicleId: selectedVehicle.id,
              makeModel: selectedVehicle.makeModel,
              licensePlate: selectedVehicle.licensePlate,
              startingMileage: parseInt(loanerStartMileage, 10) || selectedVehicle.currentMileage,
              fuelLevel: parseInt(loanerFuel, 10) || selectedVehicle.fuelLevel,
              preDamageNotes: loanerPreDamage.trim(),
              expectedReturnDate,
            }
          : null;

      const submission: IntakeSubmission = {
        customerName: customerName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        vehicleYear: parseInt(vehicleYear, 10) || 0,
        vehicleMake: vehicleMake.trim(),
        vehicleModel: vehicleModel.trim(),
        vinLast8: vinLast8.trim().toUpperCase(),
        insuranceCarrier: insuranceCarrier.trim(),
        policyNumber: policyNumber.trim(),
        claimNumber: claimNumber.trim(),
        estimatedAmount: parseFloat(estimatedAmount) || 0,
        documents,
        walkaround,
        hailMatrix,
        conditionNotes: conditionNotes.trim(),
        assignedStaffId,
        assignedStaffName: assignedStaffName.trim() || undefined,
        rental,
        signatureDataUrl: signatureDataUrl ?? '',
        agreementAcceptedAt: new Date().toISOString(),
      };
      const lead = await saveIntakePackage(submission);
      // Dual-agreement: assign the loaner against the new lead so the office
      // fleet dashboard reflects it as RENTED.
      if (rental) {
        await assignVehicle(rental.vehicleId, {
          leadId: lead.id,
          customerName: submission.customerName,
          agentName: loanerAgent.trim() || null,
          startingMileage: rental.startingMileage,
          fuelLevel: rental.fuelLevel,
          expectedReturnDate: rental.expectedReturnDate || null,
        });
      }
      onComplete(lead);
    } finally {
      setSubmitting(false);
    }
  };

  const flaggedHail = HAIL_PANELS.filter((p) => hail[p] !== 'NONE').length;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Mobile field intake"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col overflow-hidden bg-zinc-900 shadow-2xl sm:h-auto sm:max-h-[92vh] sm:max-w-md sm:rounded-xl sm:border sm:border-zinc-800"
      >
        {/* Header + step indicator */}
        <div className="border-b border-zinc-800 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-zinc-100">New Mobile Intake</h2>
              <p className="text-[11px] text-zinc-500">
                Step {step} of {TOTAL_STEPS} · {STEP_TITLES[step - 1]}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              ✕
            </button>
          </div>
          <div className="mt-3 flex gap-1">
            {STEP_TITLES.map((_, i) => (
              <span
                key={i}
                className={clsx(
                  'h-1 flex-1 rounded-full',
                  i + 1 <= step ? 'bg-sky-500' : 'bg-zinc-800',
                )}
              />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
          {step === 1 && (
            <>
              <div className="rounded-md border border-sky-500/40 bg-sky-500/5 p-2">
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500">
                  📷 Scan Document / VIN
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => void scanDocument(e.target.files?.[0], 'VIN')}
                  />
                </label>
                {scanMsg && (
                  <p className="mt-1 text-center text-[11px] text-zinc-400">{scanMsg}</p>
                )}
              </div>
              <input className={input} placeholder="Customer name *" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <input className={input} placeholder="Phone *" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <input className={input} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input className={input} placeholder="Year" inputMode="numeric" value={vehicleYear} onChange={(e) => setVehicleYear(e.target.value)} />
                <input className={input} placeholder="Make" value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} />
                <input className={input} placeholder="Model" value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} />
              </div>
              <input className={input} placeholder="VIN (last 8)" value={vinLast8} onChange={(e) => setVinLast8(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <input className={input} placeholder="Claim #" value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} />
                <input className={input} placeholder="Insurance carrier" value={insuranceCarrier} onChange={(e) => setInsuranceCarrier(e.target.value)} />
              </div>
              <CarrierTierBadge carrier={insuranceCarrier} showHint />
              <label className="block border-t border-zinc-800 pt-3">
                <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                  Intake owner / rep
                </span>
                <input
                  className={input}
                  placeholder="Assigned rep"
                  value={assignedStaffName}
                  onChange={(e) => setAssignedStaffName(e.target.value)}
                />
              </label>
            </>
          )}

          {step === 2 && (
            <>
              {DOC_SLOTS.map((slot) => (
                <label key={slot.kind} className="block">
                  <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                    {slot.label}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      setDoc(slot.kind, f);
                      if (slot.kind === 'INSURANCE_CARD') void scanDocument(f, 'INSURANCE');
                    }}
                    className="block w-full text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-zinc-200"
                  />
                  {slot.kind === 'INSURANCE_CARD' && scanMsg && (
                    <span className="mt-0.5 block text-[11px] text-sky-300">{scanMsg}</span>
                  )}
                  {docs[slot.kind] && (
                    <span className="mt-0.5 block truncate text-[11px] text-emerald-300">
                      ✓ {docs[slot.kind]?.fileName}
                    </span>
                  )}
                </label>
              ))}

              <div className="grid grid-cols-2 gap-2 border-t border-zinc-800 pt-3">
                <input className={input} placeholder="Policy #" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
                <input className={input} placeholder="Est. amount ($)" inputMode="decimal" value={estimatedAmount} onChange={(e) => setEstimatedAmount(e.target.value)} />
              </div>

              <label className="block border-t border-zinc-800 pt-3">
                <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                  Prior Estimate / Carrier Sheet
                </span>
                <input
                  type="file"
                  accept=".json,.xml,.csv,.txt"
                  onChange={(e) => void onEstimateFile(e.target.files?.[0])}
                  className="block w-full text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-zinc-200"
                />
                {parseMsg && <span className="mt-1 block text-[11px] text-sky-300">{parseMsg}</span>}
                {parsedItems.length > 0 && (
                  <ul className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-[11px] text-zinc-400">
                    {parsedItems.slice(0, 8).map((it, i) => (
                      <li key={i} className="truncate">
                        • {it.name} <span className="text-zinc-600">({it.sourcingTier})</span>
                      </li>
                    ))}
                    {parsedItems.length > 8 && <li className="text-zinc-600">…and {parsedItems.length - 8} more</li>}
                  </ul>
                )}
              </label>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                  Hail severity matrix ({flaggedHail}/{HAIL_PANELS.length} panels flagged)
                </p>
                <div className="space-y-1.5">
                  {HAIL_PANELS.map((panel) => (
                    <div key={panel} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-zinc-300">{panel}</span>
                      <div className="flex gap-1">
                        {HAIL_SEVERITIES.map((sev) => (
                          <button
                            key={sev}
                            type="button"
                            onClick={() => setHail((prev) => ({ ...prev, [panel]: sev }))}
                            aria-pressed={hail[panel] === sev}
                            className={clsx(
                              'rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                              hail[panel] === sev
                                ? SEVERITY_TONE[sev]
                                : 'border-zinc-800 bg-transparent text-zinc-600 hover:text-zinc-400',
                            )}
                          >
                            {sev === 'NONE' ? '—' : sev[0]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-zinc-600">L = Light · M = Moderate · S = Severe</p>
              </div>

              <div className="border-t border-zinc-800 pt-3">
                <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                  Pre-existing condition
                </p>
                <div className="space-y-1.5">
                  {walkaround.map((w) => (
                    <label key={w.id} className="flex items-center gap-2 text-xs text-zinc-300">
                      <input type="checkbox" checked={w.flagged} onChange={() => toggleWalk(w.id)} />
                      {w.label}
                    </label>
                  ))}
                </div>
              </div>

              <textarea
                value={conditionNotes}
                onChange={(e) => setConditionNotes(e.target.value)}
                rows={3}
                placeholder="Condition notes…"
                className={clsx(input, 'resize-none')}
              />

              <div className="border-t border-zinc-800 pt-3">
                <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                  Walkaround photos
                </p>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={(e) => addWalkaroundPhotos(e.target.files)}
                  className="block w-full text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-zinc-200"
                />
                {walkaroundPhotos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {walkaroundPhotos.map((p, i) => (
                      <div key={i} className="relative">
                        {p.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.url}
                            alt={p.fileName}
                            className="h-14 w-14 rounded border border-zinc-700 object-cover"
                          />
                        ) : (
                          <span className="text-[10px] text-zinc-400">{p.fileName}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeWalkaroundPhoto(p.url)}
                          aria-label="Remove photo"
                          className="absolute -right-1 -top-1 rounded-full bg-zinc-800 px-1 text-[10px] font-bold text-red-300"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <label className="flex items-center gap-2 text-sm text-zinc-200">
                <input
                  type="checkbox"
                  checked={provideLoaner}
                  onChange={(e) => setProvideLoaner(e.target.checked)}
                />
                Provide loaner / rental vehicle
              </label>

              {provideLoaner ? (
                <>
                  {availableFleet.length === 0 ? (
                    <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                      No fleet units currently available.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                        Select available unit
                      </p>
                      {availableFleet.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => selectVehicle(v)}
                          aria-pressed={selectedVehicleId === v.id}
                          className={clsx(
                            'flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-xs',
                            selectedVehicleId === v.id
                              ? 'border-sky-500/60 bg-sky-500/15 text-sky-100'
                              : 'border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:bg-zinc-800',
                          )}
                        >
                          <span>
                            {v.makeModel}{' '}
                            <span className="text-zinc-500">· {v.licensePlate}</span>
                          </span>
                          <span className="text-zinc-500">
                            {v.currentMileage.toLocaleString()} mi · {v.fuelLevel}%
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {selectedVehicleId && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className={input}
                          inputMode="numeric"
                          placeholder="Starting mileage"
                          value={loanerStartMileage}
                          onChange={(e) => setLoanerStartMileage(e.target.value)}
                        />
                        <input
                          className={input}
                          inputMode="numeric"
                          placeholder="Fuel level (%)"
                          value={loanerFuel}
                          onChange={(e) => setLoanerFuel(e.target.value)}
                        />
                      </div>
                      <input
                        className={input}
                        placeholder="Assigned agent / rep (checked out by)"
                        value={loanerAgent}
                        onChange={(e) => setLoanerAgent(e.target.value)}
                      />
                      <label className="block">
                        <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                          Authorized return date
                        </span>
                        <input
                          type="date"
                          className={input}
                          value={expectedReturnDate}
                          onChange={(e) => setExpectedReturnDate(e.target.value)}
                        />
                      </label>
                      <textarea
                        className={clsx(input, 'resize-none')}
                        rows={2}
                        placeholder="Loaner pre-damage notes…"
                        value={loanerPreDamage}
                        onChange={(e) => setLoanerPreDamage(e.target.value)}
                      />
                    </>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-zinc-500">
                  No loaner will be issued for this intake.
                </p>
              )}
            </>
          )}

          {step === 5 && (
            <>
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-[11px] leading-relaxed text-zinc-400">
                <p className="font-semibold text-zinc-200">
                  Specialized PDR &amp; Auto Hail Repair Service Agreement
                </p>
                <p>
                  <span className="font-semibold text-zinc-300">(a) Repair Authorization &amp; Assignment of Benefits (AOB).</span>{' '}
                  I authorize the shop to perform repairs and assign my insurance benefits to the
                  shop for direct payout of the covered loss, including any approved supplements.
                </p>
                <p>
                  <span className="font-semibold text-zinc-300">(b) PDR Paint Integrity Waiver.</span>{' '}
                  I acknowledge that severe or stretched hail dents on weathered, aged, or
                  previously repainted panels carry an inherent risk of paint micro-fracturing or
                  chipping during metal manipulation. I release the shop from liability for
                  pre-existing factory paint flaws or finish failure attributable to panel age or
                  prior refinish.
                </p>
                <p>
                  <span className="font-semibold text-zinc-300">(c) R&amp;I (Removal &amp; Installation) Liability.</span>{' '}
                  I authorize dropping headliners and removing interior trim, lamps, and glass as
                  needed, and waive liability for aged or brittle plastic clips, fasteners, or
                  electronic sensors that may fail during a hail teardown.
                </p>
                <p>
                  <span className="font-semibold text-zinc-300">(d) Hail Supplement &amp; Blueprinting Disclosure.</span>{' '}
                  I understand initial carrier drive-by or photo estimates commonly miss hidden
                  hail damage (underside bracing, unpainted aluminum panels, edge damage), and I
                  authorize a light-board scope and the submission of direct carrier supplements.
                </p>
                <p>
                  <span className="font-semibold text-zinc-300">(e) Storage, Security &amp; Mechanic&apos;s Lien.</span>{' '}
                  Vehicles left after completion or authorization withdrawal may accrue daily
                  storage fees, and the shop may exercise a mechanic&apos;s lien for unpaid
                  authorized charges as permitted by law.
                </p>
              </div>

              {provideLoaner && (
                <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border border-sky-500/30 bg-sky-500/5 p-3 text-[11px] leading-relaxed text-zinc-400">
                  <p className="font-semibold text-sky-200">Rental / Loaner Vehicle Agreement</p>
                  <p>
                    <span className="font-semibold text-zinc-300">Liability.</span> The customer is
                    responsible for the loaner while in their possession, including damage,
                    citations, and tolls.
                  </p>
                  <p>
                    <span className="font-semibold text-zinc-300">Insurance verification.</span>{' '}
                    Customer affirms valid personal auto insurance extends to the loaner; the shop
                    may verify coverage before release.
                  </p>
                  <p>
                    <span className="font-semibold text-zinc-300">Fuel &amp; mileage policy.</span>{' '}
                    The loaner is returned at the recorded fuel level; excess mileage and
                    unreturned fuel may incur charges.
                  </p>
                  <p>
                    <span className="font-semibold text-zinc-300">Authorized return.</span> The
                    loaner must be returned by the authorized return date or upon repair
                    completion, whichever comes first.
                  </p>
                </div>
              )}

              <label className="flex items-start gap-2 text-xs text-zinc-300">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
                {provideLoaner
                  ? 'I have read and accept the repair terms (a)–(e) and the Rental / Loaner Agreement, and authorize the work.'
                  : 'I have read and accept all terms (a)–(e) above and authorize the work.'}
              </label>

              <div>
                <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                  Customer signature
                </p>
                <SignaturePad onChange={setSignatureDataUrl} />
              </div>
            </>
          )}

          {step === 6 && (
            <div className="space-y-2 text-xs text-zinc-300">
              <p className="font-semibold text-zinc-100">{customerName || 'Customer'}</p>
              <p className="text-zinc-400">
                {vehicleYear} {vehicleMake} {vehicleModel}
                {vinLast8 ? ` · VIN …${vinLast8.toUpperCase()}` : ''}
              </p>
              <dl className="space-y-1 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
                <Row label="Carrier / Claim" value={`${insuranceCarrier || '—'}${claimNumber ? ` · ${claimNumber}` : ''}`} />
                <Row label="Est. amount" value={estimatedAmount ? `$${estimatedAmount}` : '—'} />
                <Row label="Documents" value={`${(Object.keys(docs) as IntakeDocKind[]).filter((k) => docs[k]).length} captured`} />
                <Row label="Hail panels flagged" value={`${flaggedHail}/${HAIL_PANELS.length}`} />
                <Row label="Parsed estimate lines" value={String(parsedItems.length)} />
                <Row
                  label="Loaner"
                  value={
                    provideLoaner && selectedVehicleId
                      ? `${availableFleet.find((v) => v.id === selectedVehicleId)?.makeModel ?? selectedVehicleId}`
                      : 'None'
                  }
                />
                <Row label="Signature" value={signatureDataUrl ? '✓ Captured' : '✗ Missing'} />
                <Row label="Agreement" value={agreed ? '✓ Accepted' : '✗ Not accepted'} />
              </dl>
              {(!signatureDataUrl || !agreed) && (
                <p className="text-[11px] text-amber-300">
                  Signature and agreement acceptance are required (Step 4) before submitting.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between gap-2 border-t border-zinc-800 p-4">
          <button
            type="button"
            onClick={() => (step === 1 ? onClose() : setStep((s) => s - 1))}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {step < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canProceed()}
              className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || !signatureDataUrl || !agreed}
              className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit Intake'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-200">{value}</dd>
    </div>
  );
}
