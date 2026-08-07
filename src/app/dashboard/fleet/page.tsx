'use client';

/**
 * Fleet & Loaner Command Center — full loaner inventory with lifecycle actions.
 *
 * Metrics header (fleet size / available / rented / maintenance) plus a table
 * of every unit with status, assignment, mileage, fuel, and Return / Maintenance
 * / Assign actions. Shares the rental-db session store with the mobile intake
 * wizard, so field loaner assignments show here on load.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  addVehicle,
  assignVehicle,
  addRentalLoanDriver,
  getFleet,
  getLatestLoanDriver,
  getLeadRentalAgreementSignature,
  getRentalHandoverRequirements,
  isHandoverItemSatisfied,
  removeVehicle,
  returnVehicle,
  setVehicleStatus,
  uploadLoanDriverDocument,
  type RentalHandoverRequirements,
  type RentalLoanDriverRecord,
} from '@/lib/rental-db';
import { genUuid, getSignedDocumentUrls } from '@/lib/storage-upload';
import type { RentalStatus, RentalVehicle } from '@/components/sales/types';

const STATUS_TONE: Record<RentalStatus, string> = {
  AVAILABLE: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  RESERVED: 'border-violet-500/40 bg-violet-500/15 text-violet-200',
  RENTED: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  MAINTENANCE: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
};

export default function FleetPage() {
  const [fleet, setFleet] = useState<RentalVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignCustomer, setAssignCustomer] = useState('');
  const [assignAgent, setAssignAgent] = useState('');
  const [assignMileage, setAssignMileage] = useState('');
  // Driver handover gate — only meaningful for a RESERVED unit's Confirm
  // Pickup (the moment keys actually change hands for a loaner the mobile
  // wizard held back). A fresh walk-in Assign from AVAILABLE is not gated
  // here — out of scope for this pass.
  const [handoverRequirements, setHandoverRequirements] = useState<RentalHandoverRequirements>({
    driversLicense: 'DOCUMENT',
    driverInsurance: 'DOCUMENT',
    rentalAgreement: 'DOCUMENT',
  });
  const [loanDriver, setLoanDriver] = useState<RentalLoanDriverRecord | null>(null);
  const [rentalAgreementSignatureUrl, setRentalAgreementSignatureUrl] = useState<string | null>(null);
  // Signed URLs for whichever of licenseDocumentUrl / insuranceDocumentUrl /
  // rentalAgreementSignatureUrl are on file, keyed by that Storage path.
  // Minted once, batched, when Confirm Pickup opens for a RESERVED unit —
  // never eagerly for the whole fleet list.
  const [signedHandoverUrls, setSignedHandoverUrls] = useState<Map<string, string>>(new Map());
  const [newDriverName, setNewDriverName] = useState('');
  const [newLicenseFile, setNewLicenseFile] = useState<{ fileName: string; file: File } | null>(null);
  const [newInsuranceFile, setNewInsuranceFile] = useState<{ fileName: string; file: File } | null>(
    null,
  );
  const [newLicenseNumber, setNewLicenseNumber] = useState('');
  const [newLicenseExpiry, setNewLicenseExpiry] = useState('');
  const [newInsuranceCarrier, setNewInsuranceCarrier] = useState('');
  const [newPolicyNumber, setNewPolicyNumber] = useState('');
  const [newPolicyExpiry, setNewPolicyExpiry] = useState('');
  const [licenseAttested, setLicenseAttested] = useState(false);
  const [insuranceAttested, setInsuranceAttested] = useState(false);
  const [rentalAgreementAttested, setRentalAgreementAttested] = useState(false);
  // Add-vehicle form.
  const [addOpen, setAddOpen] = useState(false);
  const [addMakeModel, setAddMakeModel] = useState('');
  const [addPlate, setAddPlate] = useState('');
  const [addMileage, setAddMileage] = useState('');
  const [addFuel, setAddFuel] = useState('100');

  const refresh = useCallback(async () => {
    try {
      setFleet(await getFleet());
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Data sync failed');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setError(null);
        const rows = await getFleet();
        if (cancelled) return;
        setFleet(rows);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Data sync failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Refresh-safe: re-pull fleet when the tab/window regains focus so field
  // assignments made in the intake wizard show up here.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);

  const metrics = useMemo(
    () => ({
      total: fleet.length,
      available: fleet.filter((v) => v.currentStatus === 'AVAILABLE').length,
      reserved: fleet.filter((v) => v.currentStatus === 'RESERVED').length,
      rented: fleet.filter((v) => v.currentStatus === 'RENTED').length,
      maintenance: fleet.filter((v) => v.currentStatus === 'MAINTENANCE').length,
    }),
    [fleet],
  );

  const startAssign = (v: RentalVehicle) => {
    setAssigningId(v.id);
    // A RESERVED unit already has a customer/agent from the routing-panel
    // hold — prefill so confirming pickup doesn't require retyping them.
    setAssignCustomer(v.assignedCustomer ?? '');
    setAssignAgent(v.assignedAgent ?? '');
    setAssignMileage(String(v.currentMileage));
    setNewDriverName('');
    setNewLicenseFile(null);
    setNewInsuranceFile(null);
    setNewLicenseNumber('');
    setNewLicenseExpiry('');
    setNewInsuranceCarrier('');
    setNewPolicyNumber('');
    setNewPolicyExpiry('');
    setLicenseAttested(false);
    setInsuranceAttested(false);
    setRentalAgreementAttested(false);
    setLoanDriver(null);
    setRentalAgreementSignatureUrl(null);
    setSignedHandoverUrls(new Map());
    // Confirm Pickup on a RESERVED unit is the moment keys actually change
    // hands — pull whatever driver documentation the wizard already
    // captured (possibly partial, if that's why it's still RESERVED) so the
    // rep isn't asked to start over. The rental-agreement signature (if any)
    // lives on the lead, not the loan-driver row or the vehicle — Fleet has
    // no other visibility into it.
    if (v.currentStatus === 'RESERVED') {
      void (async () => {
        const [record, signatureUrl] = await Promise.all([
          getLatestLoanDriver(v.id, v.assignedLeadId),
          getLeadRentalAgreementSignature(v.assignedLeadId ?? null),
        ]);
        setLoanDriver(record);
        setRentalAgreementSignatureUrl(signatureUrl);
        // A manager releasing keys should be able to look at the license,
        // not just see that a filename exists — a blurry or expired one
        // passes the "on file" check identically to a good one otherwise.
        const paths = [record?.licenseDocumentUrl, record?.insuranceDocumentUrl, signatureUrl].filter(
          (p): p is string => typeof p === 'string',
        );
        setSignedHandoverUrls(await getSignedDocumentUrls(paths));
      })();
    }
  };

  // A RESERVED unit's Confirm Pickup is gated; a fresh walk-in Assign from
  // AVAILABLE is not (out of scope for this pass — see the state comment).
  // This is a manager at a counter, not a rep at a doorstep — requiring a
  // name here doesn't run into the field-first rule the intake flows follow.
  const driverNameSatisfied = (v: RentalVehicle) =>
    v.currentStatus !== 'RESERVED' ||
    newDriverName.trim() !== '' ||
    Boolean(loanDriver?.driverName?.trim());
  const licenseSatisfied = (v: RentalVehicle) =>
    v.currentStatus !== 'RESERVED' ||
    isHandoverItemSatisfied(handoverRequirements.driversLicense, {
      hasTypedData: newLicenseNumber.trim() !== '' && newLicenseExpiry.trim() !== '',
      attested: licenseAttested || Boolean(loanDriver?.driversLicenseAttestedAt),
      hasDocument: Boolean(newLicenseFile) || Boolean(loanDriver?.licenseDocumentUrl),
    });
  const insuranceSatisfied = (v: RentalVehicle) =>
    v.currentStatus !== 'RESERVED' ||
    isHandoverItemSatisfied(handoverRequirements.driverInsurance, {
      hasTypedData: newInsuranceCarrier.trim() !== '' && newPolicyNumber.trim() !== '',
      attested: insuranceAttested || Boolean(loanDriver?.driverInsuranceAttestedAt),
      hasDocument: Boolean(newInsuranceFile) || Boolean(loanDriver?.insuranceDocumentUrl),
    });
  const rentalAgreementSatisfied = (v: RentalVehicle) =>
    v.currentStatus !== 'RESERVED' ||
    isHandoverItemSatisfied(handoverRequirements.rentalAgreement, {
      hasTypedData: true,
      attested: rentalAgreementAttested || Boolean(loanDriver?.rentalAgreementAttestedAt),
      hasDocument: Boolean(rentalAgreementSignatureUrl),
    });
  const handoverAllowed = (v: RentalVehicle) =>
    driverNameSatisfied(v) && licenseSatisfied(v) && insuranceSatisfied(v) && rentalAgreementSatisfied(v);

  const confirmAssign = async (v: RentalVehicle) => {
    if (v.currentStatus === 'RESERVED' && !handoverAllowed(v)) return; // belt-and-suspenders; button is also disabled
    const hasNewCapture =
      newLicenseFile ||
      newInsuranceFile ||
      newDriverName.trim() ||
      newLicenseNumber.trim() ||
      newInsuranceCarrier.trim() ||
      licenseAttested ||
      insuranceAttested ||
      rentalAgreementAttested;
    if (v.currentStatus === 'RESERVED' && hasNewCapture) {
      // No fallback to the customer's name or a placeholder — gated above
      // (driverNameSatisfied is part of handoverAllowed), so one of these is
      // guaranteed non-empty by the time a RESERVED confirm reaches here.
      // The defensive return matches the belt-and-suspenders check above: a
      // handover record asserting the policyholder drove, with someone
      // else's license attached, is worse than no record — it looks
      // authoritative when it isn't.
      const driverName = newDriverName.trim() || loanDriver?.driverName?.trim() || '';
      if (!driverName) return;
      const attestedBy = assignAgent.trim() || 'Rep';
      const nowIso = new Date().toISOString();
      const loanDriverId = genUuid();
      const [licensePath, insurancePath] = await Promise.all([
        newLicenseFile ? uploadLoanDriverDocument(loanDriverId, newLicenseFile.file, 'license') : null,
        newInsuranceFile ? uploadLoanDriverDocument(loanDriverId, newInsuranceFile.file, 'insurance') : null,
      ]);
      await addRentalLoanDriver({
        id: loanDriverId,
        rentalVehicleId: v.id,
        leadId: v.assignedLeadId,
        driverName,
        licenseDocumentUrl: licensePath ?? loanDriver?.licenseDocumentUrl ?? null,
        insuranceDocumentUrl: insurancePath ?? loanDriver?.insuranceDocumentUrl ?? null,
        licenseNumber: newLicenseNumber.trim() || null,
        licenseExpiry: newLicenseExpiry || null,
        insuranceCarrier: newInsuranceCarrier.trim() || null,
        policyNumber: newPolicyNumber.trim() || null,
        policyExpiry: newPolicyExpiry || null,
        driversLicenseAttestedBy: licenseAttested ? attestedBy : null,
        driversLicenseAttestedAt: licenseAttested ? nowIso : null,
        driverInsuranceAttestedBy: insuranceAttested ? attestedBy : null,
        driverInsuranceAttestedAt: insuranceAttested ? nowIso : null,
        rentalAgreementAttestedBy: rentalAgreementAttested ? attestedBy : null,
        rentalAgreementAttestedAt: rentalAgreementAttested ? nowIso : null,
      });
    }
    await assignVehicle(v.id, {
      // Carry the RESERVED unit's lead/RO binding through to RENTED — a
      // fresh walk-in Assign from AVAILABLE has no assignedLeadId, so this
      // is a no-op (null) in that case.
      leadId: v.assignedLeadId,
      customerName: assignCustomer.trim() || 'Walk-in',
      agentName: assignAgent.trim() || null,
      startingMileage: parseInt(assignMileage, 10) || v.currentMileage,
      fuelLevel: v.fuelLevel,
    });
    setAssigningId(null);
    await refresh();
  };

  const doReturn = async (id: string) => {
    await returnVehicle(id);
    await refresh();
  };
  const setStatus = async (id: string, status: RentalStatus) => {
    await setVehicleStatus(id, status);
    await refresh();
  };
  const doRemove = async (id: string) => {
    await removeVehicle(id);
    await refresh();
  };
  const submitAddVehicle = async () => {
    if (!addMakeModel.trim()) return;
    await addVehicle({
      makeModel: addMakeModel.trim(),
      licensePlate: addPlate.trim(),
      currentMileage: parseInt(addMileage, 10) || 0,
      fuelLevel: parseInt(addFuel, 10) || 100,
    });
    setAddMakeModel('');
    setAddPlate('');
    setAddMileage('');
    setAddFuel('100');
    setAddOpen(false);
    await refresh();
  };

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Fleet &amp; Loaner Command Center</h1>
            <p className="text-sm text-zinc-400">Loaner vehicle inventory &amp; return tracking</p>
          </div>
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
          >
            + Add New Vehicle
          </button>
        </header>

        {addOpen && (
          <div className="mb-5 flex flex-wrap items-end gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <input
              value={addMakeModel}
              onChange={(e) => setAddMakeModel(e.target.value)}
              placeholder="Make & Model *"
              className="min-w-[12rem] flex-1 rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none"
            />
            <input
              value={addPlate}
              onChange={(e) => setAddPlate(e.target.value)}
              placeholder="License plate"
              className="w-36 rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none"
            />
            <input
              value={addMileage}
              onChange={(e) => setAddMileage(e.target.value)}
              inputMode="numeric"
              placeholder="Mileage"
              className="w-28 rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none"
            />
            <input
              value={addFuel}
              onChange={(e) => setAddFuel(e.target.value)}
              inputMode="numeric"
              placeholder="Fuel %"
              className="w-24 rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void submitAddVehicle()}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Add
            </button>
          </div>
        )}

        {/* Metrics */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Metric label="Total Fleet" value={metrics.total} />
          <Metric label="Available" value={metrics.available} tone="text-emerald-300" />
          <Metric label="Reserved" value={metrics.reserved} tone="text-violet-300" />
          <Metric label="Rented Out" value={metrics.rented} tone="text-sky-300" />
          <Metric label="In Maintenance" value={metrics.maintenance} tone="text-amber-300" />
        </div>

        {error ? (
          <div className="p-4 bg-red-950/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
            ⚠️ Error loading fleet: {error}
          </div>
        ) : loading ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
            Loading fleet…
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/60 text-[11px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-mono">Unit / Vehicle</th>
                  <th className="px-3 py-2 font-mono">Plate</th>
                  <th className="px-3 py-2 font-mono">Status</th>
                  <th className="px-3 py-2 font-mono">Assigned</th>
                  <th className="px-3 py-2 font-mono">Mileage</th>
                  <th className="px-3 py-2 font-mono">Fuel</th>
                  <th className="px-3 py-2 font-mono">Actions</th>
                </tr>
              </thead>
              <tbody>
                {fleet.map((v) => (
                  <FleetRow
                    key={v.id}
                    v={v}
                    assigning={assigningId === v.id}
                    assignCustomer={assignCustomer}
                    assignAgent={assignAgent}
                    assignMileage={assignMileage}
                    onAssignCustomer={setAssignCustomer}
                    onAssignAgent={setAssignAgent}
                    onAssignMileage={setAssignMileage}
                    handoverRequirements={handoverRequirements}
                    loanDriver={loanDriver}
                    rentalAgreementSignatureUrl={rentalAgreementSignatureUrl}
                    signedHandoverUrls={signedHandoverUrls}
                    newDriverName={newDriverName}
                    newLicenseFile={newLicenseFile}
                    newInsuranceFile={newInsuranceFile}
                    newLicenseNumber={newLicenseNumber}
                    newLicenseExpiry={newLicenseExpiry}
                    newInsuranceCarrier={newInsuranceCarrier}
                    newPolicyNumber={newPolicyNumber}
                    newPolicyExpiry={newPolicyExpiry}
                    licenseAttested={licenseAttested}
                    insuranceAttested={insuranceAttested}
                    rentalAgreementAttested={rentalAgreementAttested}
                    handoverAllowed={handoverAllowed(v)}
                    onNewDriverName={setNewDriverName}
                    onNewLicenseFile={setNewLicenseFile}
                    onNewInsuranceFile={setNewInsuranceFile}
                    onNewLicenseNumber={setNewLicenseNumber}
                    onNewLicenseExpiry={setNewLicenseExpiry}
                    onNewInsuranceCarrier={setNewInsuranceCarrier}
                    onNewPolicyNumber={setNewPolicyNumber}
                    onNewPolicyExpiry={setNewPolicyExpiry}
                    onLicenseAttested={setLicenseAttested}
                    onInsuranceAttested={setInsuranceAttested}
                    onRentalAgreementAttested={setRentalAgreementAttested}
                    onStartAssign={() => startAssign(v)}
                    onCancelAssign={() => setAssigningId(null)}
                    onConfirmAssign={() => void confirmAssign(v)}
                    onReturn={() => void doReturn(v.id)}
                    onMaintenance={() => void setStatus(v.id, 'MAINTENANCE')}
                    onAvailable={() => void setStatus(v.id, 'AVAILABLE')}
                    onRemove={() => void doRemove(v.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={clsx('mt-1 text-2xl font-bold tabular-nums', tone ?? 'text-zinc-100')}>
        {value}
      </p>
    </div>
  );
}

interface FleetRowProps {
  v: RentalVehicle;
  assigning: boolean;
  assignCustomer: string;
  assignAgent: string;
  assignMileage: string;
  onAssignCustomer: (v: string) => void;
  onAssignAgent: (v: string) => void;
  onAssignMileage: (v: string) => void;
  handoverRequirements: RentalHandoverRequirements;
  loanDriver: RentalLoanDriverRecord | null;
  rentalAgreementSignatureUrl: string | null;
  signedHandoverUrls: Map<string, string>;
  newDriverName: string;
  newLicenseFile: { fileName: string; file: File } | null;
  newInsuranceFile: { fileName: string; file: File } | null;
  newLicenseNumber: string;
  newLicenseExpiry: string;
  newInsuranceCarrier: string;
  newPolicyNumber: string;
  newPolicyExpiry: string;
  licenseAttested: boolean;
  insuranceAttested: boolean;
  rentalAgreementAttested: boolean;
  handoverAllowed: boolean;
  onNewDriverName: (v: string) => void;
  onNewLicenseFile: (f: { fileName: string; file: File } | null) => void;
  onNewInsuranceFile: (f: { fileName: string; file: File } | null) => void;
  onNewLicenseNumber: (v: string) => void;
  onNewLicenseExpiry: (v: string) => void;
  onNewInsuranceCarrier: (v: string) => void;
  onNewPolicyNumber: (v: string) => void;
  onNewPolicyExpiry: (v: string) => void;
  onLicenseAttested: (v: boolean) => void;
  onInsuranceAttested: (v: boolean) => void;
  onRentalAgreementAttested: (v: boolean) => void;
  onStartAssign: () => void;
  onCancelAssign: () => void;
  onConfirmAssign: () => void;
  onReturn: () => void;
  onMaintenance: () => void;
  onAvailable: () => void;
  onRemove: () => void;
}

function FleetRow({
  v,
  assigning,
  assignCustomer,
  assignAgent,
  assignMileage,
  onAssignCustomer,
  onAssignAgent,
  onAssignMileage,
  handoverRequirements,
  loanDriver,
  rentalAgreementSignatureUrl,
  signedHandoverUrls,
  newDriverName,
  newLicenseFile,
  newInsuranceFile,
  newLicenseNumber,
  newLicenseExpiry,
  newInsuranceCarrier,
  newPolicyNumber,
  newPolicyExpiry,
  licenseAttested,
  insuranceAttested,
  rentalAgreementAttested,
  handoverAllowed,
  onNewDriverName,
  onNewLicenseFile,
  onNewInsuranceFile,
  onNewLicenseNumber,
  onNewLicenseExpiry,
  onNewInsuranceCarrier,
  onNewPolicyNumber,
  onNewPolicyExpiry,
  onLicenseAttested,
  onInsuranceAttested,
  onRentalAgreementAttested,
  onStartAssign,
  onCancelAssign,
  onConfirmAssign,
  onReturn,
  onMaintenance,
  onAvailable,
  onRemove,
}: FleetRowProps) {
  const btn =
    'rounded border px-2 py-0.5 text-[11px] font-medium transition-colors';
  return (
    <>
      <tr className="border-b border-zinc-800/60">
        <td className="px-3 py-2">
          <div className="font-medium text-zinc-100">{v.makeModel}</div>
          <div className="font-mono text-[11px] text-zinc-500">{v.id}</div>
        </td>
        <td className="px-3 py-2 font-mono text-xs text-zinc-300">{v.licensePlate}</td>
        <td className="px-3 py-2">
          <span
            className={clsx(
              'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold',
              STATUS_TONE[v.currentStatus],
            )}
          >
            {v.currentStatus}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-zinc-300">
          {v.assignedCustomer ? (
            <>
              {v.assignedCustomer}
              {v.assignedAgent && (
                <span className="block text-[10px] text-sky-300">
                  agent: {v.assignedAgent}
                </span>
              )}
              {v.assignedLeadId && (
                <span className="block font-mono text-[10px] text-zinc-500">
                  {v.assignedLeadId}
                </span>
              )}
              {v.expectedReturnDate && (
                <span className="block text-[10px] text-amber-300">
                  due {v.expectedReturnDate}
                </span>
              )}
            </>
          ) : (
            <span className="text-zinc-600">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-xs tabular-nums text-zinc-300">
          {v.startingMileage != null && v.startingMileage !== v.currentMileage ? (
            <>
              {v.startingMileage.toLocaleString()} →{' '}
              {v.currentMileage.toLocaleString()}
            </>
          ) : (
            v.currentMileage.toLocaleString()
          )}
        </td>
        <td className="px-3 py-2 text-xs tabular-nums text-zinc-300">{v.fuelLevel}%</td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            {v.currentStatus === 'RENTED' && (
              <button
                type="button"
                onClick={onReturn}
                className={clsx(btn, 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20')}
              >
                Check-In / Return
              </button>
            )}
            {v.currentStatus === 'AVAILABLE' && !assigning && (
              <button
                type="button"
                onClick={onStartAssign}
                className={clsx(btn, 'border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20')}
              >
                Assign
              </button>
            )}
            {v.currentStatus === 'RESERVED' && !assigning && (
              <>
                <button
                  type="button"
                  onClick={onStartAssign}
                  className={clsx(btn, 'border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20')}
                >
                  Confirm Pickup
                </button>
                <button
                  type="button"
                  onClick={onReturn}
                  className={clsx(btn, 'border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20')}
                >
                  Release
                </button>
              </>
            )}
            {v.currentStatus === 'MAINTENANCE' ? (
              <button
                type="button"
                onClick={onAvailable}
                className={clsx(btn, 'border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-800')}
              >
                Mark Available
              </button>
            ) : v.currentStatus !== 'RESERVED' ? (
              <button
                type="button"
                onClick={onMaintenance}
                className={clsx(btn, 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20')}
              >
                Mark Maintenance
              </button>
            ) : null}
            {v.currentStatus !== 'RENTED' && v.currentStatus !== 'RESERVED' && (
              <button
                type="button"
                onClick={onRemove}
                className={clsx(btn, 'border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20')}
              >
                Retire
              </button>
            )}
          </div>
        </td>
      </tr>
      {assigning && (
        <tr className="border-b border-zinc-800/60 bg-zinc-950/40">
          <td colSpan={7} className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-zinc-500">
                {v.currentStatus === 'RESERVED' ? `Confirm pickup for ${v.id}:` : `Assign ${v.id} to:`}
              </span>
              <input
                value={assignCustomer}
                onChange={(e) => onAssignCustomer(e.target.value)}
                placeholder="Customer name"
                className="rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none"
              />
              <input
                value={assignAgent}
                onChange={(e) => onAssignAgent(e.target.value)}
                placeholder="Sales agent / rep"
                className="rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none"
              />
              <input
                value={assignMileage}
                onChange={(e) => onAssignMileage(e.target.value)}
                inputMode="numeric"
                placeholder="Starting mileage"
                className="w-32 rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={onConfirmAssign}
                disabled={v.currentStatus === 'RESERVED' && !handoverAllowed}
                className="rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={onCancelAssign}
                className="rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>

            {/* Handover gate — Confirm Pickup only. The keys physically
                change hands here; a fresh walk-in Assign from AVAILABLE
                isn't gated in this pass. */}
            {v.currentStatus === 'RESERVED' && (
              <div className="mt-2 space-y-2 rounded-md border border-zinc-700 bg-zinc-900/60 p-2.5">
                <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                  Driver on file
                  {loanDriver?.driverName ? ` — ${loanDriver.driverName}` : ' — none captured yet'}
                </p>
                {!loanDriver?.driverName?.trim() && !newDriverName.trim() && (
                  <span className="block text-[11px] text-red-300">
                    ✗ Missing — REQUIRED, blocks key release. Type a name, or confirm it&apos;s the
                    customer below.
                  </span>
                )}
                <div className="flex gap-1.5">
                  <input
                    value={newDriverName}
                    onChange={(e) => onNewDriverName(e.target.value)}
                    placeholder={loanDriver?.driverName || 'Driver full name'}
                    className="flex-1 rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none"
                  />
                  {assignCustomer.trim() && (
                    <button
                      type="button"
                      onClick={() => onNewDriverName(assignCustomer.trim())}
                      title={`Fill with customer name: ${assignCustomer.trim()}`}
                      className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[10.5px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
                    >
                      Same as customer
                    </button>
                  )}
                </div>

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
                        {loanDriver?.licenseDocumentUrl && !newLicenseFile && (
                          <div className="flex items-center gap-2">
                            {signedHandoverUrls.get(loanDriver.licenseDocumentUrl) ? (
                              <a
                                href={signedHandoverUrls.get(loanDriver.licenseDocumentUrl)}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={signedHandoverUrls.get(loanDriver.licenseDocumentUrl)}
                                  alt="Driver's license on file"
                                  className="h-10 w-10 rounded border border-zinc-700 object-cover"
                                />
                              </a>
                            ) : (
                              <span className="text-[11px] text-zinc-500">Loading…</span>
                            )}
                            <span className="text-[11px] text-emerald-300">
                              ✓ Already on file — upload below to replace it
                            </span>
                          </div>
                        )}
                        {!loanDriver?.licenseDocumentUrl && !newLicenseFile && (
                          <span className="block text-[11px] text-red-300">
                            ✗ Missing — DOCUMENT required, blocks key release. Upload below to
                            capture it now.
                          </span>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) onNewLicenseFile({ fileName: f.name, file: f });
                          }}
                          className="block w-full text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-zinc-200"
                        />
                        {newLicenseFile && (
                          <span className="mt-0.5 block truncate text-[11px] text-emerald-300">
                            ✓ {newLicenseFile.fileName}
                            {loanDriver?.licenseDocumentUrl ? ' (replacing document on file)' : ''}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-1.5">
                          <input
                            value={newLicenseNumber}
                            onChange={(e) => onNewLicenseNumber(e.target.value)}
                            placeholder="License #"
                            className="rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none"
                          />
                          <input
                            type="date"
                            value={newLicenseExpiry}
                            onChange={(e) => onNewLicenseExpiry(e.target.value)}
                            className="rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-100 focus:border-sky-500/60 focus:outline-none"
                          />
                        </div>
                        <label className="flex items-start gap-2 text-[11px] text-zinc-300">
                          <input
                            type="checkbox"
                            checked={licenseAttested || Boolean(loanDriver?.driversLicenseAttestedAt)}
                            onChange={(e) => onLicenseAttested(e.target.checked)}
                            className="mt-0.5"
                          />
                          I verified this license number and expiration date against the physical
                          card or the driver&apos;s app.
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
                        {loanDriver?.insuranceDocumentUrl && !newInsuranceFile && (
                          <div className="flex items-center gap-2">
                            {signedHandoverUrls.get(loanDriver.insuranceDocumentUrl) ? (
                              <a
                                href={signedHandoverUrls.get(loanDriver.insuranceDocumentUrl)}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={signedHandoverUrls.get(loanDriver.insuranceDocumentUrl)}
                                  alt="Proof of insurance on file"
                                  className="h-10 w-10 rounded border border-zinc-700 object-cover"
                                />
                              </a>
                            ) : (
                              <span className="text-[11px] text-zinc-500">Loading…</span>
                            )}
                            <span className="text-[11px] text-emerald-300">
                              ✓ Already on file — upload below to replace it
                            </span>
                          </div>
                        )}
                        {!loanDriver?.insuranceDocumentUrl && !newInsuranceFile && (
                          <span className="block text-[11px] text-red-300">
                            ✗ Missing — DOCUMENT required, blocks key release. Upload below to
                            capture it now.
                          </span>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) onNewInsuranceFile({ fileName: f.name, file: f });
                          }}
                          className="block w-full text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-zinc-200"
                        />
                        {newInsuranceFile && (
                          <span className="mt-0.5 block truncate text-[11px] text-emerald-300">
                            ✓ {newInsuranceFile.fileName}
                            {loanDriver?.insuranceDocumentUrl ? ' (replacing document on file)' : ''}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <input
                          value={newInsuranceCarrier}
                          onChange={(e) => onNewInsuranceCarrier(e.target.value)}
                          placeholder="Insurance carrier"
                          className="w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none"
                        />
                        <div className="grid grid-cols-2 gap-1.5">
                          <input
                            value={newPolicyNumber}
                            onChange={(e) => onNewPolicyNumber(e.target.value)}
                            placeholder="Policy #"
                            className="rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none"
                          />
                          <input
                            type="date"
                            value={newPolicyExpiry}
                            onChange={(e) => onNewPolicyExpiry(e.target.value)}
                            className="rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-100 focus:border-sky-500/60 focus:outline-none"
                          />
                        </div>
                        <label className="flex items-start gap-2 text-[11px] text-zinc-300">
                          <input
                            type="checkbox"
                            checked={insuranceAttested || Boolean(loanDriver?.driverInsuranceAttestedAt)}
                            onChange={(e) => onInsuranceAttested(e.target.checked)}
                            className="mt-0.5"
                          />
                          I verified this insurance carrier and policy against the physical card or
                          the driver&apos;s app.
                        </label>
                      </>
                    )}
                  </div>
                )}

                {handoverRequirements.rentalAgreement !== 'NONE' && (
                  <div className="space-y-1.5 border-t border-zinc-700/70 pt-2">
                    <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
                      Rental / loaner agreement
                      <span className="rounded bg-zinc-700 px-1 py-0.5 font-semibold text-zinc-300">
                        {handoverRequirements.rentalAgreement}
                      </span>
                    </span>
                    {handoverRequirements.rentalAgreement === 'DOCUMENT' ? (
                      rentalAgreementSignatureUrl ? (
                        <div className="flex items-center gap-2">
                          {signedHandoverUrls.get(rentalAgreementSignatureUrl) ? (
                            <a
                              href={signedHandoverUrls.get(rentalAgreementSignatureUrl)}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={signedHandoverUrls.get(rentalAgreementSignatureUrl)}
                                alt="Rental agreement signature on file"
                                className="h-10 w-10 rounded border border-zinc-700 bg-white object-contain"
                              />
                            </a>
                          ) : (
                            <span className="text-[11px] text-zinc-500">Loading…</span>
                          )}
                          <span className="text-[11px] text-emerald-300">✓ Signed on file</span>
                        </div>
                      ) : (
                        <span className="block text-[11px] text-red-300">
                          ✗ Missing — this must be signed during intake; it cannot be captured from
                          Fleet.
                        </span>
                      )
                    ) : (
                      <label className="flex items-start gap-2 text-[11px] text-zinc-300">
                        <input
                          type="checkbox"
                          checked={rentalAgreementAttested || Boolean(loanDriver?.rentalAgreementAttestedAt)}
                          onChange={(e) => onRentalAgreementAttested(e.target.checked)}
                          className="mt-0.5"
                        />
                        I confirm {newDriverName.trim() || loanDriver?.driverName || 'the driver'}{' '}
                        reviewed and verbally accepted the Rental / Loaner Agreement terms — this
                        shop does not require a written signature for it.
                      </label>
                    )}
                  </div>
                )}

                {!handoverAllowed && (
                  <p className="text-[11px] text-red-300">
                    ⚠ This shop requires the missing item(s) above before these keys can be
                    released. Confirm is disabled until they&apos;re provided.
                  </p>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
