'use client';

/**
 * ShopIntakeForm — shop profile & SOP onboarding form.
 *
 * Multi-section: shop details, operating hours, dynamic staff roster, PDR
 * technician matrix, and a required digital engagement agreement. Client-side
 * validation with success/error banners; persists via /api/v1/shop/config.
 */
import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  STAFF_ROLES,
  type PdrMatrixRow,
  type ShopConfig,
  type StaffMember,
} from './types';
import { getRegionalPdrBaseline, parsePdrMatrixFile } from '@/lib/pdr-matrix-parser';

function genId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}
const blankStaff = (): StaffMember => ({
  id: genId('staff'),
  name: '',
  role: 'TECH',
  email: '',
  phone: '',
});
const blankMatrix = (): PdrMatrixRow => ({
  id: genId('pdr'),
  technician: '',
  dime: 0,
  nickel: 0,
  quarter: 0,
  halfDollar: 0,
});

const input =
  'w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40';

export function ShopIntakeForm() {
  const [shopName, setShopName] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [zip, setZip] = useState('');
  const [taxId, setTaxId] = useState('');
  const [weekdays, setWeekdays] = useState('');
  const [saturday, setSaturday] = useState('');
  const [sunday, setSunday] = useState('');
  const [staff, setStaff] = useState<StaffMember[]>([blankStaff()]);
  const [pdrMatrix, setPdrMatrix] = useState<PdrMatrixRow[]>([blankMatrix()]);
  const [engagementAccepted, setEngagementAccepted] = useState(false);
  const [hasFleet, setHasFleet] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [matrixMsg, setMatrixMsg] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prefill from any previously-saved config.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/shop/config');
        const json = (await res.json()) as { config?: ShopConfig | null };
        const c = json.config;
        if (cancelled || !c) return;
        setShopName(c.shopName ?? '');
        setAddressLine(c.addressLine ?? '');
        setCity(c.city ?? '');
        setStateCode(c.state ?? '');
        setZip(c.zip ?? '');
        setTaxId(c.taxId ?? '');
        setWeekdays(c.operatingHours?.weekdays ?? '');
        setSaturday(c.operatingHours?.saturday ?? '');
        setSunday(c.operatingHours?.sunday ?? '');
        if (c.staff?.length) setStaff(c.staff);
        if (c.pdrMatrix?.length) setPdrMatrix(c.pdrMatrix);
        setEngagementAccepted(Boolean(c.engagementAccepted));
        setHasFleet(c.hasFleet !== false);
      } catch {
        /* no existing config */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patchStaff = (id: string, patch: Partial<StaffMember>) =>
    setStaff((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const patchMatrix = (id: string, patch: Partial<PdrMatrixRow>) =>
    setPdrMatrix((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const importMatrixFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const rows = parsePdrMatrixFile(text);
      if (rows.length === 0) {
        setMatrixMsg('Could not parse any technician rows from that file — check the format.');
        return;
      }
      setPdrMatrix(rows);
      setMatrixMsg(`Imported ${rows.length} technician rate row${rows.length === 1 ? '' : 's'} from ${file.name}.`);
    } catch {
      setMatrixMsg('Could not read that file.');
    }
  };

  const validate = (): string[] => {
    const errs: string[] = [];
    if (!shopName.trim()) errs.push('Shop name is required.');
    if (!stateCode.trim()) errs.push('State is required (for prompt-payment rules).');
    if (!taxId.trim()) errs.push('Tax ID / EIN is required.');
    if (!engagementAccepted) errs.push('You must accept the engagement agreement.');
    if (staff.some((s) => s.name.trim() && !s.role.trim()))
      errs.push('Every staff member needs a role.');
    return errs;
  };

  const submit = async () => {
    const errs = validate();
    if (errs.length > 0) {
      setStatus({ type: 'error', msg: errs.join(' ') });
      return;
    }
    setSubmitting(true);
    setStatus(null);
    try {
      // No manually-entered or uploaded matrix rows — fall back to the
      // regional default baseline (keyed off the shop's state) so the shop
      // always has a PDR rate on file rather than submitting with none.
      const enteredMatrix = pdrMatrix.filter((m) => m.technician.trim());
      const finalMatrix =
        enteredMatrix.length > 0
          ? enteredMatrix
          : [
              {
                id: genId('pdr'),
                technician: 'Shop Default (Regional Baseline)',
                ...getRegionalPdrBaseline(stateCode),
              },
            ];

      const payload: ShopConfig = {
        shopName: shopName.trim(),
        addressLine: addressLine.trim(),
        city: city.trim(),
        state: stateCode.trim().toUpperCase(),
        zip: zip.trim(),
        taxId: taxId.trim(),
        operatingHours: {
          weekdays: weekdays.trim(),
          saturday: saturday.trim(),
          sunday: sunday.trim(),
        },
        engagementAccepted,
        staff: staff.filter((s) => s.name.trim()),
        pdrMatrix: finalMatrix,
        hasFleet,
      };
      const res = await fetch('/api/v1/shop/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (res.ok && json.success) {
        setStatus({ type: 'success', msg: 'Shop profile saved.' });
      } else {
        setStatus({ type: 'error', msg: json.error ?? 'Could not save shop profile.' });
      }
    } catch {
      setStatus({ type: 'error', msg: 'Network error — could not save.' });
    } finally {
      setSubmitting(false);
    }
  };

  const sectionTitle = 'text-sm font-semibold text-zinc-100';
  const label = 'mb-1 block text-xs font-medium text-zinc-400';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      {status && (
        <div
          className={clsx(
            'rounded-lg border px-3 py-2 text-sm',
            status.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-red-500/40 bg-red-500/10 text-red-200',
          )}
          role="status"
        >
          {status.msg}
        </div>
      )}

      {/* Shop details */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className={sectionTitle}>Shop Details</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className={label}>Shop name *</span>
            <input className={input} value={shopName} onChange={(e) => setShopName(e.target.value)} />
          </label>
          <label className="sm:col-span-2">
            <span className={label}>Address</span>
            <input className={input} value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />
          </label>
          <label>
            <span className={label}>City</span>
            <input className={input} value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className={label}>State *</span>
              <input
                className={input}
                value={stateCode}
                maxLength={2}
                placeholder="TX"
                onChange={(e) => setStateCode(e.target.value.toUpperCase())}
              />
            </label>
            <label>
              <span className={label}>ZIP</span>
              <input className={input} value={zip} onChange={(e) => setZip(e.target.value)} />
            </label>
          </div>
          <label>
            <span className={label}>Tax ID / EIN *</span>
            <input className={input} value={taxId} onChange={(e) => setTaxId(e.target.value)} />
          </label>
        </div>
      </section>

      {/* Operating hours */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className={sectionTitle}>Operating Hours</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label>
            <span className={label}>Weekdays</span>
            <input className={input} placeholder="8:00 AM – 6:00 PM" value={weekdays} onChange={(e) => setWeekdays(e.target.value)} />
          </label>
          <label>
            <span className={label}>Saturday</span>
            <input className={input} placeholder="9:00 AM – 2:00 PM" value={saturday} onChange={(e) => setSaturday(e.target.value)} />
          </label>
          <label>
            <span className={label}>Sunday</span>
            <input className={input} placeholder="Closed" value={sunday} onChange={(e) => setSunday(e.target.value)} />
          </label>
        </div>
      </section>

      {/* Fleet / rental */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className={sectionTitle}>Fleet / Rental</h2>
        <p className="mt-1 text-xs text-zinc-400">
          Turn this off for a partner or independent shop that doesn&apos;t maintain its own
          loaner/rental fleet — the Shop Drop-off routing action will skip vehicle allocation.
        </p>
        <label className="mt-2 flex items-center gap-2 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={hasFleet}
            onChange={(e) => setHasFleet(e.target.checked)}
          />
          This shop maintains a loaner / rental fleet.
        </label>
      </section>

      {/* Staff roster */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center justify-between">
          <h2 className={sectionTitle}>Staff Roster</h2>
          <button
            type="button"
            onClick={() => setStaff((p) => [...p, blankStaff()])}
            className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800"
          >
            + Add staff
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {staff.map((s) => (
            <div key={s.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_1.4fr_1fr_auto]">
              <input className={input} placeholder="Name" value={s.name} onChange={(e) => patchStaff(s.id, { name: e.target.value })} />
              <select className={input} value={s.role} onChange={(e) => patchStaff(s.id, { role: e.target.value })}>
                {STAFF_ROLES.map((r) => (
                  <option key={r} value={r} className="bg-zinc-900">
                    {r}
                  </option>
                ))}
              </select>
              <input className={input} placeholder="Email" value={s.email} onChange={(e) => patchStaff(s.id, { email: e.target.value })} />
              <input className={input} placeholder="Phone" value={s.phone} onChange={(e) => patchStaff(s.id, { phone: e.target.value })} />
              <button
                type="button"
                onClick={() => setStaff((p) => p.filter((x) => x.id !== s.id))}
                className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-red-300 hover:bg-zinc-800"
              >
                Remove
              </button>
            </div>
          ))}
          {staff.length === 0 && <p className="text-xs text-zinc-500">No staff added.</p>}
        </div>
      </section>

      {/* PDR technician matrix */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center justify-between">
          <h2 className={sectionTitle}>PDR Technician Matrix</h2>
          <button
            type="button"
            onClick={() => setPdrMatrix((p) => [...p, blankMatrix()])}
            className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800"
          >
            + Add technician
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">Per-technician matrix rate ($) by dent coin size.</p>

        {/* CSV/JSON matrix import dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            void importMatrixFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          className={clsx(
            'mt-3 cursor-pointer rounded-md border border-dashed px-3 py-3 text-center text-xs transition-colors',
            dragActive
              ? 'border-sky-500/60 bg-sky-500/10 text-sky-200'
              : 'border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400',
          )}
        >
          Drop a CSV or JSON matrix file here, or click to browse.
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json,text/csv,application/json"
            className="hidden"
            onChange={(e) => void importMatrixFile(e.target.files?.[0])}
          />
        </div>
        {matrixMsg && <p className="mt-1 text-[11px] text-sky-300">{matrixMsg}</p>}
        <p className="mt-1 text-[10px] text-zinc-600">
          No file uploaded? A regional default baseline (based on shop state) is used automatically.
        </p>

        <div className="mt-3 space-y-2">
          <div className="hidden grid-cols-[1.6fr_repeat(4,1fr)_auto] gap-2 px-1 text-[10px] uppercase tracking-wider text-zinc-500 sm:grid">
            <span>Technician</span>
            <span>Dime</span>
            <span>Nickel</span>
            <span>Quarter</span>
            <span>Half $</span>
            <span />
          </div>
          {pdrMatrix.map((m) => (
            <div key={m.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1.6fr_repeat(4,1fr)_auto]">
              <input className={input} placeholder="Technician" value={m.technician} onChange={(e) => patchMatrix(m.id, { technician: e.target.value })} />
              <input className={input} inputMode="decimal" value={m.dime || ''} onChange={(e) => patchMatrix(m.id, { dime: parseFloat(e.target.value) || 0 })} />
              <input className={input} inputMode="decimal" value={m.nickel || ''} onChange={(e) => patchMatrix(m.id, { nickel: parseFloat(e.target.value) || 0 })} />
              <input className={input} inputMode="decimal" value={m.quarter || ''} onChange={(e) => patchMatrix(m.id, { quarter: parseFloat(e.target.value) || 0 })} />
              <input className={input} inputMode="decimal" value={m.halfDollar || ''} onChange={(e) => patchMatrix(m.id, { halfDollar: parseFloat(e.target.value) || 0 })} />
              <button
                type="button"
                onClick={() => setPdrMatrix((p) => p.filter((x) => x.id !== m.id))}
                className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-red-300 hover:bg-zinc-800"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Engagement agreement */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className={sectionTitle}>Engagement Agreement</h2>
        <p className="mt-1 text-xs text-zinc-400">
          I accept the MESH platform engagement agreement and authorize the configured
          staff to operate on behalf of this shop.
        </p>
        <label className="mt-2 flex items-center gap-2 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={engagementAccepted}
            onChange={(e) => setEngagementAccepted(e.target.checked)}
          />
          I agree to the engagement terms. *
        </label>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save Shop Profile'}
        </button>
      </div>
    </form>
  );
}
