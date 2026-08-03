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
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { parseEstimate } from '@/lib/estimate-parser';
import { saveIntakePackage } from '@/lib/sales-db';
import { importEstimateLineItems } from '@/lib/ops-db';
import {
  assignVehicle,
  reserveVehicle,
  addRentalLoanDriver,
  getAvailableVehicles,
  getRentalHandoverRequirements,
  isHandoverItemSatisfied,
  type RentalHandoverRequirements,
} from '@/lib/rental-db';
import { getCurrentProfile } from '@/lib/auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { CarrierTierBadge } from '@/components/carrier/CarrierTierBadge';
import { getCarrierIntel, CHECKLIST_ITEM_LABEL, type ChecklistItemId } from '@/lib/carrier-intel';
import { resolveRentalOperator, type RentalOperatorBinding } from '@/lib/agreement-engine';
import { SignaturePad } from './SignaturePad';
import { AobAgreementText } from './AobAgreementText';
import type { PartsLineItem } from '@/components/ops/types';
import type {
  HailPanelAssessment,
  HailSeverity,
  IntakeDocKind,
  IntakeDocumentRef,
  IntakeLead,
  IntakeSubmission,
  ProxyPolicyholder,
  RentalAssignmentInfo,
  RentalVehicle,
  WalkaroundItem,
} from './types';

// --- config -----------------------------------------------------------------

// Rigorous alphanumeric mask for the captured VIN segment. This field models
// VIN-last-8 throughout the app (mock OCR data, DB column semantics, display
// labels) rather than a full 17-char VIN, so validation targets its actual
// established length: exactly 8 alphanumeric characters, or empty (optional).
const VIN_SEGMENT_LENGTH = 8;
const VIN_SEGMENT_RE = new RegExp(`^[A-Z0-9]{${VIN_SEGMENT_LENGTH}}$`);
const sanitizeVinSegment = (raw: string) =>
  raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, VIN_SEGMENT_LENGTH);

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
  /** holdMessage is set when a loaner was held RESERVED instead of released
   *  because a required driver document was missing — the intake still
   *  completed; only the vehicle handoff was deferred. */
  onComplete: (lead: IntakeLead, holdMessage?: string) => void;
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

  // Policyholder Identity Split — defaults to Yes (person at intake IS the
  // Named Insured). Toggling No captures a proxy for the Remote AOB gate.
  const [policyholderMatch, setPolicyholderMatch] = useState(true);
  const [proxyFullName, setProxyFullName] = useState('');
  const [proxyRelationship, setProxyRelationship] = useState('');
  const [proxyPhone, setProxyPhone] = useState('');
  const [proxyEmail, setProxyEmail] = useState('');

  // Step 2
  const [policyNumber, setPolicyNumber] = useState('');
  const [estimatedAmount, setEstimatedAmount] = useState('');
  const [docs, setDocs] = useState<Record<IntakeDocKind, IntakeDocumentRef | null>>({
    DL_FRONT: null,
    DL_BACK: null,
    INSURANCE_CARD: null,
    PRIOR_ESTIMATE: null,
    WALKAROUND: null,
    DAMAGE_PHOTO: null,
    VIN_TO_DAMAGE_ALIGNMENT: null,
    LINE_BOARD_SWEEP: null,
    FOUR_CORNER_PHOTOS: null,
    UNDERSIDE_BRACING_SHOTS: null,
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
  // Loaner driver — may differ from the AOB signer (Named Insured or proxy).
  // Not auto-filled from rentalOperator: a legal handover record should be a
  // deliberate entry, not a silent assumption.
  const [driverName, setDriverName] = useState('');
  const [driverLicenseFile, setDriverLicenseFile] = useState<IntakeDocumentRef | null>(null);
  const [driverInsuranceFile, setDriverInsuranceFile] = useState<IntakeDocumentRef | null>(null);
  // ATTESTED_DATA typed fields — a rep who verified the physical card/app
  // can type what it says instead of photographing it. Named distinctly
  // from the customer's own insuranceCarrier/policyNumber (Step 1, for the
  // claim) — this is the DRIVER's own license/insurance, an unrelated
  // concept that happens to reuse similar words.
  const [driverLicenseNumber, setDriverLicenseNumber] = useState('');
  const [driverLicenseExpiry, setDriverLicenseExpiry] = useState('');
  const [driverInsuranceCarrier, setDriverInsuranceCarrier] = useState('');
  const [driverPolicyNumber, setDriverPolicyNumber] = useState('');
  const [driverPolicyExpiry, setDriverPolicyExpiry] = useState('');
  // Attestation — independent per item, per the three-level model.
  const [licenseAttested, setLicenseAttested] = useState(false);
  const [insuranceAttested, setInsuranceAttested] = useState(false);
  const [rentalAgreementAttested, setRentalAgreementAttested] = useState(false);
  const [handoverRequirements, setHandoverRequirements] = useState<RentalHandoverRequirements>({
    driversLicense: 'DOCUMENT',
    driverInsurance: 'DOCUMENT',
    rentalAgreement: 'DOCUMENT',
  });

  // Step 5 — repair AOB signature (Named Insured on-site only; deferred to
  // the Remote AOB Execution Gate otherwise).
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  // Rental / Loaner Agreement signature — a legally separate document from
  // the AOB above. Needed whenever a loaner is issued at all, independent
  // of policyholderMatch: a loaner to the Named Insured previously shared
  // the AOB's signature pad with no distinct record of its own; a loaner to
  // a proxy previously required this signature only when the proxy was
  // literally the one taking custody (rentalOperator.source === 'PROXY'),
  // silently skipping it otherwise. Both were gaps — this now applies
  // uniformly to any loaner, regardless of who's driving.
  const [rentalSignatureDataUrl, setRentalSignatureDataUrl] = useState<string | null>(null);
  const [rentalAgreed, setRentalAgreed] = useState(false);

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

  // Cheap, unconditional read (mirrors getAvailableVehicles above) — a shop
  // with no fleet just never reaches the step where this value matters.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const requirements = await getRentalHandoverRequirements();
      if (!cancelled) setHandoverRequirements(requirements);
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

  // Dynamic per-carrier required documentation (Carrier Intelligence layer).
  const carrierChecklist: ChecklistItemId[] = getCarrierIntel(insuranceCarrier).requiredChecklist;

  // Agreement Auto-Population Engine — binds the Rental Fleet Agreement to
  // whoever is actually taking possession of the loaner (the on-site proxy,
  // when the Named Insured isn't present, rather than the absent policyholder).
  const rentalOperator = resolveRentalOperator({
    policyholderMatch,
    proxyPolicyholder: policyholderMatch
      ? null
      : { fullName: proxyFullName, relationship: proxyRelationship, phone: proxyPhone, email: proxyEmail },
    customerName,
    phone,
    email,
    documents: docs,
  });

  // The AOB is signed on-site only when the Named Insured is present;
  // otherwise it defers entirely to the Remote AOB Execution Gate.
  const requiresAobSignature = policyholderMatch;
  // The Rental / Loaner Agreement's signature pad is a hard, step-advance-
  // blocking requirement (like the AOB) ONLY when the shop has this item
  // set to DOCUMENT — the strictest of the three levels. ATTESTED_DATA and
  // NONE are handled below via handoverAllowed instead, the same
  // non-blocking path drivers_license/driver_insurance already use: a rep
  // can still finish and save the intake, and the vehicle simply holds
  // RESERVED instead of being released. Only an actual required signature
  // is treated as a submit-blocking legal document, same as the AOB.
  const requiresRentalSignature = provideLoaner && handoverRequirements.rentalAgreement === 'DOCUMENT';

  const driversLicenseSatisfied = isHandoverItemSatisfied(handoverRequirements.driversLicense, {
    hasTypedData: driverLicenseNumber.trim() !== '' && driverLicenseExpiry.trim() !== '',
    attested: licenseAttested,
    hasDocument: driverLicenseFile !== null,
  });
  const driverInsuranceSatisfied = isHandoverItemSatisfied(handoverRequirements.driverInsurance, {
    hasTypedData: driverInsuranceCarrier.trim() !== '' && driverPolicyNumber.trim() !== '',
    attested: insuranceAttested,
    hasDocument: driverInsuranceFile !== null,
  });
  // hasTypedData: true — the rental agreement's ATTESTED_DATA path has no
  // separate typed fields of its own (unlike license/insurance); the
  // attestation itself IS the data being asserted.
  const rentalAgreementItemSatisfied = isHandoverItemSatisfied(handoverRequirements.rentalAgreement, {
    hasTypedData: true,
    attested: rentalAgreementAttested,
    hasDocument: rentalSignatureDataUrl !== null,
  });

  const handoverAllowed =
    !provideLoaner ||
    (driversLicenseSatisfied && driverInsuranceSatisfied && rentalAgreementItemSatisfied);

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
        if (typeof d.vinLast8 === 'string') setVinLast8(sanitizeVinSegment(d.vinLast8));
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
    if (step === 1) {
      return (
        customerName.trim() !== '' &&
        phone.trim() !== '' &&
        (vinLast8 === '' || VIN_SEGMENT_RE.test(vinLast8)) &&
        (policyholderMatch || proxyFullName.trim() !== '')
      );
    }
    // Step 2: Driver's License, Insurance Card, Prior Estimate, and the
    // carrier-required checklist are all optional to ADVANCE — a rep can
    // push the lead forward instantly and fill them in later. The checklist
    // is no longer a step-advance gate; it's enforced later, at RO
    // provisioning (see convertLeadToRO), where a missing item blocks
    // opening the repair order instead of blocking the lead from being
    // saved. See the persistent warning rendered in the Step 2 UI below.
    // Vehicle selection is required to advance; the driver-document BLOCK
    // gate is enforced separately (handoverAllowed, checked on the final
    // submit button) rather than here, so a rep can still fill in the rest
    // of the intake while documents are outstanding — only the actual
    // key-handover action is what BLOCK is meant to stop.
    if (step === 4) return !provideLoaner || selectedVehicleId !== null;
    if (step === 5) {
      const aobOk = !requiresAobSignature || (signatureDataUrl !== null && agreed);
      const rentalOk = !requiresRentalSignature || (rentalSignatureDataUrl !== null && rentalAgreed);
      return aobOk && rentalOk;
    }
    return true;
  };

  const submit = async () => {
    // Defensive re-check — blocks an invalid VIN length before the payload is
    // built/sent, regardless of how the wizard's step gate was reached.
    if (vinLast8 !== '' && !VIN_SEGMENT_RE.test(vinLast8)) {
      setScanMsg(`VIN segment must be exactly ${VIN_SEGMENT_LENGTH} alphanumeric characters.`);
      return;
    }
    setSubmitting(true);
    setScanMsg(null);
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
      // Falls back to the rental operator's name rather than blocking: the
      // DB column is NOT NULL, but field-first means an empty driver-name
      // input must never stop the rest of the intake from saving. Only the
      // document BLOCK gate (handoverAllowed) is allowed to actually block.
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
              driverName: driverName.trim() || rentalOperator.name || 'Unknown driver',
              driverLicenseDocUrl: driverLicenseFile?.url ?? null,
              driverInsuranceDocUrl: driverInsuranceFile?.url ?? null,
            }
          : null;

      const proxyPolicyholder: ProxyPolicyholder | null = policyholderMatch
        ? null
        : {
            fullName: proxyFullName.trim(),
            relationship: proxyRelationship.trim(),
            phone: proxyPhone.trim(),
            email: proxyEmail.trim(),
          };

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
        // Remote path: no on-site signature is collected for the main repair
        // AOB — the policyholder signs later via the Remote AOB Execution
        // Gate. Two independent signatures now, not one shared column.
        signatureDataUrl: requiresAobSignature ? signatureDataUrl ?? '' : '',
        rentalAgreementSignatureDataUrl: requiresRentalSignature ? rentalSignatureDataUrl ?? '' : '',
        agreementAcceptedAt: new Date().toISOString(),
        policyholderMatch,
        proxyPolicyholder,
      };
      const lead = await saveIntakePackage(submission);

      // Bind the initial insurance estimate to the supplement audit data
      // pipeline — best-effort; a parse/import failure never blocks intake.
      if (parsedItems.length > 0 && submission.claimNumber) {
        try {
          await importEstimateLineItems(submission.claimNumber, parsedItems);
        } catch (err) {
          console.warn('[MobileIntakeWizard] estimate import failed:', err);
        }
      }

      // Dual-agreement: assign the loaner against the new lead. Field-first —
      // a missing BLOCK-required driver document must never cost the rep
      // the intake. When handoverAllowed, this is a full checkout (RENTED,
      // real mileage/fuel). When it's not, the vehicle is held RESERVED
      // instead — the existing two-phase state (reserveVehicle, already
      // used by the routing panel's own hold flow) rather than fabricating
      // a checkout with a document requirement unmet. Either way, the
      // driver info actually captured is recorded so nothing has to be
      // re-entered once the missing document arrives.
      let loanerHoldMessage: string | undefined;
      if (rental) {
        if (handoverAllowed) {
          await assignVehicle(rental.vehicleId, {
            leadId: lead.id,
            customerName: submission.customerName,
            agentName: loanerAgent.trim() || null,
            startingMileage: rental.startingMileage,
            fuelLevel: rental.fuelLevel,
            expectedReturnDate: rental.expectedReturnDate || null,
          });
        } else {
          await reserveVehicle(rental.vehicleId, lead.id, submission.customerName);
          loanerHoldMessage = `Keys for ${rental.makeModel} are HELD (not released) — missing required driver document(s). Complete them in Fleet to release.`;
        }
        // Records who actually took the keys — may differ from the AOB
        // signer above. Best-effort internally (see rental-db.ts); never
        // throws, so it can't block the rest of submit.
        const attestedBy = assignedStaffName.trim() || 'Rep';
        const nowIso = new Date().toISOString();
        await addRentalLoanDriver({
          rentalVehicleId: rental.vehicleId,
          leadId: lead.id,
          driverName: rental.driverName,
          licenseDocumentUrl: rental.driverLicenseDocUrl,
          insuranceDocumentUrl: rental.driverInsuranceDocUrl,
          licenseNumber: driverLicenseNumber.trim() || null,
          licenseExpiry: driverLicenseExpiry || null,
          insuranceCarrier: driverInsuranceCarrier.trim() || null,
          policyNumber: driverPolicyNumber.trim() || null,
          policyExpiry: driverPolicyExpiry || null,
          driversLicenseAttestedBy: licenseAttested ? attestedBy : null,
          driversLicenseAttestedAt: licenseAttested ? nowIso : null,
          driverInsuranceAttestedBy: insuranceAttested ? attestedBy : null,
          driverInsuranceAttestedAt: insuranceAttested ? nowIso : null,
          rentalAgreementAttestedBy: rentalAgreementAttested ? attestedBy : null,
          rentalAgreementAttestedAt: rentalAgreementAttested ? nowIso : null,
        });
      }

      // Remote AOB Execution Gate: dispatch the secure signing link. Best-
      // effort — a dispatch failure doesn't block the lead from being created.
      // The dispatch result is folded into the lead handed to onComplete so
      // the board's notice can reflect it accurately.
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
          console.warn('[MobileIntakeWizard] remote AOB dispatch failed:', err);
        }
      }

      onComplete(finalLead, loanerHoldMessage);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown error.';
      setScanMsg(`⚠ Intake did not complete (${detail}). Please retry.`);
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
              <input
                className={input}
                placeholder="VIN (last 8)"
                inputMode="text"
                maxLength={VIN_SEGMENT_LENGTH}
                value={vinLast8}
                onChange={(e) => setVinLast8(sanitizeVinSegment(e.target.value))}
                aria-invalid={vinLast8 !== '' && !VIN_SEGMENT_RE.test(vinLast8)}
              />
              {vinLast8 !== '' && !VIN_SEGMENT_RE.test(vinLast8) && (
                <p className="text-[11px] text-amber-400">
                  VIN segment must be exactly {VIN_SEGMENT_LENGTH} alphanumeric characters.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <input className={input} placeholder="Claim #" value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} />
                <input className={input} placeholder="Insurance carrier" value={insuranceCarrier} onChange={(e) => setInsuranceCarrier(e.target.value)} />
              </div>
              <CarrierTierBadge carrier={insuranceCarrier} showHint />
              {insuranceCarrier.trim() && (
                <CarrierIntelBadge carrier={insuranceCarrier} />
              )}

              <div className="border-t border-zinc-800 pt-3">
                <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-zinc-500">
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
                      A Remote AOB Secure Signing Link will be dispatched to the proxy below instead
                      of collecting an on-site signature.
                    </p>
                    <input
                      className={input}
                      placeholder="Proxy full name *"
                      value={proxyFullName}
                      onChange={(e) => setProxyFullName(e.target.value)}
                    />
                    <input
                      className={input}
                      placeholder="Relationship to policyholder"
                      value={proxyRelationship}
                      onChange={(e) => setProxyRelationship(e.target.value)}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className={input}
                        placeholder="Proxy phone"
                        value={proxyPhone}
                        onChange={(e) => setProxyPhone(e.target.value)}
                      />
                      <input
                        className={input}
                        placeholder="Proxy email"
                        value={proxyEmail}
                        onChange={(e) => setProxyEmail(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

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
              <p className="text-[11px] text-zinc-500">
                Document Vault — Driver&apos;s License, Insurance Card, and Prior Estimate are
                optional here; capture them now or follow up later.
              </p>
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
                  {docs[slot.kind] ? (
                    <span className="mt-0.5 block truncate text-[11px] text-emerald-300">
                      ✓ {docs[slot.kind]?.fileName}
                    </span>
                  ) : (
                    <span className="mt-0.5 inline-flex rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                      {slot.label}: Pending
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
                {!docs.PRIOR_ESTIMATE && (
                  <span className="mt-0.5 inline-flex rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                    Initial Estimate: Pending
                  </span>
                )}
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

              {carrierChecklist.length > 0 && (
                <div className="space-y-2 border-t border-amber-500/20 bg-amber-500/5 p-2 pt-3">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-amber-300">
                    Carrier-Required Documentation
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    {insuranceCarrier || 'This carrier'} flags claims for scrutiny — capture these
                    when possible.
                  </p>
                  {carrierChecklist.some((kind) => !docs[kind]) && (
                    <p className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">
                      ⚠ Missing: {carrierChecklist
                        .filter((kind) => !docs[kind])
                        .map((kind) => CHECKLIST_ITEM_LABEL[kind])
                        .join(', ')}
                      . The lead can still be saved, but the repair order cannot be opened until
                      these are captured.
                    </p>
                  )}
                  {carrierChecklist.map((kind) => (
                    <label key={kind} className="block">
                      <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                        {CHECKLIST_ITEM_LABEL[kind]} <span className="text-red-400">*</span>
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => setDoc(kind, e.target.files?.[0])}
                        className="block w-full text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-zinc-200"
                      />
                      {docs[kind] && (
                        <span className="mt-0.5 block truncate text-[11px] text-emerald-300">
                          ✓ {docs[kind]?.fileName}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
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

                      <div className="space-y-3 rounded-md border border-zinc-700 bg-zinc-800/40 p-2.5">
                        <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                          Driver taking the keys{' '}
                          <span className="normal-case text-zinc-600">
                            (may differ from the AOB signer)
                          </span>
                        </p>
                        <input
                          className={input}
                          placeholder={rentalOperator.name || 'Driver full name'}
                          value={driverName}
                          onChange={(e) => setDriverName(e.target.value)}
                        />

                        {handoverRequirements.driversLicense !== 'NONE' && (
                          <div className="space-y-1.5 border-t border-zinc-700/70 pt-2">
                            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
                              Driver&apos;s license
                              <span className="rounded bg-zinc-700 px-1 py-0.5 font-semibold text-zinc-300">
                                {handoverRequirements.driversLicense}
                              </span>
                            </span>
                            {handoverRequirements.driversLicense === 'DOCUMENT' ? (
                              <>
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) {
                                      setDriverLicenseFile({
                                        kind: 'DL_FRONT',
                                        fileName: f.name,
                                        url: URL.createObjectURL(f),
                                      });
                                    }
                                  }}
                                  className="block w-full text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-zinc-200"
                                />
                                {driverLicenseFile && (
                                  <span className="block truncate text-[11px] text-emerald-300">
                                    ✓ {driverLicenseFile.fileName}
                                  </span>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="grid grid-cols-2 gap-1.5">
                                  <input
                                    className={input}
                                    placeholder="License #"
                                    value={driverLicenseNumber}
                                    onChange={(e) => setDriverLicenseNumber(e.target.value)}
                                  />
                                  <input
                                    type="date"
                                    className={input}
                                    value={driverLicenseExpiry}
                                    onChange={(e) => setDriverLicenseExpiry(e.target.value)}
                                  />
                                </div>
                                <label className="flex items-start gap-2 text-[11px] text-zinc-300">
                                  <input
                                    type="checkbox"
                                    checked={licenseAttested}
                                    onChange={(e) => setLicenseAttested(e.target.checked)}
                                    className="mt-0.5"
                                  />
                                  I verified this license number and expiration date against the
                                  physical card or the driver&apos;s app.
                                </label>
                              </>
                            )}
                          </div>
                        )}

                        {handoverRequirements.driverInsurance !== 'NONE' && (
                          <div className="space-y-1.5 border-t border-zinc-700/70 pt-2">
                            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
                              Proof of insurance
                              <span className="rounded bg-zinc-700 px-1 py-0.5 font-semibold text-zinc-300">
                                {handoverRequirements.driverInsurance}
                              </span>
                            </span>
                            {handoverRequirements.driverInsurance === 'DOCUMENT' ? (
                              <>
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) {
                                      setDriverInsuranceFile({
                                        kind: 'INSURANCE_CARD',
                                        fileName: f.name,
                                        url: URL.createObjectURL(f),
                                      });
                                    }
                                  }}
                                  className="block w-full text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-zinc-200"
                                />
                                {driverInsuranceFile && (
                                  <span className="block truncate text-[11px] text-emerald-300">
                                    ✓ {driverInsuranceFile.fileName}
                                  </span>
                                )}
                              </>
                            ) : (
                              <>
                                <input
                                  className={input}
                                  placeholder="Insurance carrier"
                                  value={driverInsuranceCarrier}
                                  onChange={(e) => setDriverInsuranceCarrier(e.target.value)}
                                />
                                <div className="grid grid-cols-2 gap-1.5">
                                  <input
                                    className={input}
                                    placeholder="Policy #"
                                    value={driverPolicyNumber}
                                    onChange={(e) => setDriverPolicyNumber(e.target.value)}
                                  />
                                  <input
                                    type="date"
                                    className={input}
                                    value={driverPolicyExpiry}
                                    onChange={(e) => setDriverPolicyExpiry(e.target.value)}
                                  />
                                </div>
                                <label className="flex items-start gap-2 text-[11px] text-zinc-300">
                                  <input
                                    type="checkbox"
                                    checked={insuranceAttested}
                                    onChange={(e) => setInsuranceAttested(e.target.checked)}
                                    className="mt-0.5"
                                  />
                                  I verified this insurance carrier and policy against the physical
                                  card or the driver&apos;s app.
                                </label>
                              </>
                            )}
                          </div>
                        )}

                        {!handoverAllowed && (
                          <p className="text-[11px] text-amber-300">
                            ⚠ This shop requires the missing item(s) above before the keys can be
                            released. The intake will still save and the vehicle will be held
                            RESERVED — nothing here blocks submitting.
                          </p>
                        )}
                      </div>
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

          {step === 5 && !policyholderMatch && (
            <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-100">
              <p className="font-semibold text-amber-200">Remote AOB Execution Gate</p>
              <p>
                {proxyFullName || 'The proxy'} isn&apos;t the Named Insured, so no on-site signature
                is collected here. Submitting this intake will email
                {proxyEmail ? ` ${proxyEmail}` : ' the proxy'} a Remote AOB Secure Signing Link to
                review and sign the same agreement off-site.
              </p>
              <p className="text-amber-300/80">
                The lead stays at NEW until the proxy signs remotely, which then locks it to AOB
                Signed automatically.
              </p>
            </div>
          )}

          {step === 5 && policyholderMatch && (
            <>
              <AobAgreementText
                customerName={customerName}
                vehicleYear={vehicleYear}
                vehicleMake={vehicleMake}
                vehicleModel={vehicleModel}
                vinLast8={vinLast8}
                claimNumber={claimNumber}
                insuranceCarrier={insuranceCarrier}
                policyNumber={policyNumber}
              />

              <label className="flex items-start gap-2 text-xs text-zinc-300">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
                I have read and accept all terms (a)–(e) above and authorize the work.
              </label>

              <div>
                <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                  Customer signature (repair AOB)
                </p>
                <SignaturePad onChange={setSignatureDataUrl} />
              </div>
            </>
          )}

          {/* Rental / Loaner Agreement — a legally separate document from the
              AOB above. Rendered whenever a loaner is being issued at all
              AND the shop requires something for it (NONE hides this
              entirely), regardless of policyholderMatch or who's driving. */}
          {step === 5 && provideLoaner && handoverRequirements.rentalAgreement !== 'NONE' && (
            <>
              <RentalAgreementText operator={rentalOperator} />
              <p className="text-[11px] text-amber-200">
                {driverName || rentalOperator.name || 'The driver'} is taking custody of the loaner
                today. This Rental / Loaner Agreement is handled separately from the repair AOB
                {!policyholderMatch ? ', which the policyholder signs remotely' : ''}.
              </p>
              {handoverRequirements.rentalAgreement === 'DOCUMENT' ? (
                <>
                  <label className="flex items-start gap-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={rentalAgreed}
                      onChange={(e) => setRentalAgreed(e.target.checked)}
                      className="mt-0.5"
                    />
                    I have read and accept the Rental / Loaner Agreement on behalf of{' '}
                    {driverName || rentalOperator.name || 'the driver'}, and authorize release of
                    the vehicle.
                  </label>
                  <div>
                    <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                      {driverName || rentalOperator.name || 'Driver'} signature (Rental Agreement)
                    </p>
                    <SignaturePad onChange={setRentalSignatureDataUrl} />
                  </div>
                </>
              ) : (
                <label className="flex items-start gap-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={rentalAgreementAttested}
                    onChange={(e) => setRentalAgreementAttested(e.target.checked)}
                    className="mt-0.5"
                  />
                  I confirm {driverName || rentalOperator.name || 'the driver'} reviewed and
                  verbally accepted the Rental / Loaner Agreement terms above — this shop does not
                  require a written signature for it.
                </label>
              )}
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
                <Row
                  label="Policyholder"
                  value={policyholderMatch ? 'Named Insured on-site' : `Proxy — ${proxyFullName || 'unnamed'}`}
                />
                {carrierChecklist.length > 0 && (
                  <Row
                    label="Carrier checklist"
                    value={`${carrierChecklist.filter((k) => docs[k]).length}/${carrierChecklist.length} captured`}
                  />
                )}
                {!policyholderMatch && <Row label="Remote AOB" value="Will dispatch on submit" />}
                {requiresAobSignature && (
                  <>
                    <Row label="AOB signature" value={signatureDataUrl ? '✓ Captured' : '✗ Missing'} />
                    <Row label="AOB agreement" value={agreed ? '✓ Accepted' : '✗ Not accepted'} />
                  </>
                )}
                {requiresRentalSignature && (
                  <>
                    <Row
                      label="Rental agreement signature"
                      value={rentalSignatureDataUrl ? '✓ Captured' : '✗ Missing'}
                    />
                    <Row
                      label="Rental agreement accepted"
                      value={rentalAgreed ? '✓ Accepted' : '✗ Not accepted'}
                    />
                  </>
                )}
                {provideLoaner && (
                  <Row
                    label="Handover requirements"
                    value={handoverAllowed ? '✓ OK to release' : '⚠ Missing — will hold RESERVED'}
                  />
                )}
              </dl>
              {requiresAobSignature && (!signatureDataUrl || !agreed) && (
                <p className="text-[11px] text-amber-300">
                  AOB signature and agreement acceptance are required (Step 5) before submitting.
                </p>
              )}
              {requiresRentalSignature && (!rentalSignatureDataUrl || !rentalAgreed) && (
                <p className="text-[11px] text-amber-300">
                  Rental agreement signature and acceptance are required (Step 5) before submitting.
                </p>
              )}
              {provideLoaner && !handoverAllowed && (
                <p className="text-[11px] text-amber-300">
                  Missing handover requirement(s) above (Steps 4–5) — the intake will still save,
                  but this vehicle will stay RESERVED instead of being released. Complete the
                  requirement(s) in Fleet to release it.
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
            <div className="flex flex-col items-end gap-1">
              {scanMsg && (
                <p className="max-w-[220px] rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-right text-[11px] text-red-200">
                  {scanMsg}
                </p>
              )}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={
                  submitting ||
                  (requiresAobSignature && (!signatureDataUrl || !agreed)) ||
                  (requiresRentalSignature && (!rentalSignatureDataUrl || !rentalAgreed))
                  // Deliberately NOT gated on handoverAllowed — field-first:
                  // a missing driver document must never cost the rep the
                  // whole intake. See submit() below: it still saves
                  // everything and just holds the vehicle RESERVED instead
                  // of releasing it.
                }
                className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit Intake'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Rental Fleet Agreement text, bound to whichever driver resolveRentalOperator
 *  picked — the on-site proxy when the Named Insured isn't present, else the
 *  customer. Rendered whether or not the main repair AOB is signed on-site. */
function RentalAgreementText({ operator }: { operator: RentalOperatorBinding }) {
  return (
    <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border border-sky-500/30 bg-sky-500/5 p-3 text-[11px] leading-relaxed text-zinc-400">
      <p className="font-semibold text-sky-200">Rental / Loaner Vehicle Agreement</p>
      <p>
        <span className="font-semibold text-zinc-300">Bound driver.</span>{' '}
        {operator.source === 'PROXY'
          ? `This loaner is issued to ${operator.name || 'the on-site proxy'}${
              operator.relationship ? ` (${operator.relationship} of the policyholder)` : ''
            }, the on-site driver, rather than the absent Named Insured.`
          : `This loaner is issued to ${operator.name || 'the customer'}, the Named Insured.`}{' '}
        Driver&apos;s license on file:{' '}
        {operator.licenseOnFile ? 'Yes' : 'Pending — capture before releasing the vehicle.'}
      </p>
      <p>
        <span className="font-semibold text-zinc-300">Liability.</span>{' '}
        {operator.name || 'The bound driver'} is responsible for the loaner while in their
        possession, including damage, citations, and tolls.
      </p>
      <p>
        <span className="font-semibold text-zinc-300">Insurance verification.</span>{' '}
        {operator.name || 'The bound driver'} affirms valid personal auto insurance extends to
        the loaner; the shop may verify coverage before release.
      </p>
      <p>
        <span className="font-semibold text-zinc-300">Fuel &amp; mileage policy.</span> The
        loaner is returned at the recorded fuel level; excess mileage and unreturned fuel may
        incur charges.
      </p>
      <p>
        <span className="font-semibold text-zinc-300">Authorized return.</span> The loaner must
        be returned by the authorized return date or upon repair completion, whichever comes
        first.
      </p>
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

const RISK_TONE: Record<'LOW' | 'MODERATE' | 'HIGH', string> = {
  LOW: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  MODERATE: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  HIGH: 'border-red-500/40 bg-red-500/10 text-red-200',
};

/** Carrier lowball/supplement risk badge (distinct from CarrierTierBadge's
 *  FNOL-automation tier) — see src/lib/carrier-intel.ts. */
function CarrierIntelBadge({ carrier }: { carrier: string }) {
  const intel = getCarrierIntel(carrier);
  return (
    <div
      className={clsx(
        'rounded-md border px-2 py-1 text-[11px] font-medium',
        RISK_TONE[intel.riskProfile],
      )}
    >
      {intel.lowballFlag ? '⚠ Lowball risk' : 'Standard risk'} · {intel.riskProfile}
      {intel.supplementFlag && ' · Expect supplement'}
    </div>
  );
}
