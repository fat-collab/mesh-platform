'use client';

/**
 * SupplementDrawer — create/edit a carrier supplement claim.
 *
 * Header fields (RO, customer, vehicle, carrier, claim, lifecycle), a line-item
 * editor with explicit categorization (incl. hidden clips/fasteners & parts),
 * per-line photo evidence, carrier status tracking, and a live total delta.
 */
import { useState } from 'react';
import { clsx } from 'clsx';
import { computeTotalDelta, genSupplementId, saveSupplement } from '@/lib/supplement-db';
import {
  LIFECYCLE_LABEL,
  LIFECYCLE_ORDER,
  SUPPLEMENT_CATEGORIES,
  SUPPLEMENT_CATEGORY_LABEL,
  SUPPLEMENT_ITEM_STATUSES,
  type SupplementItem,
  type SupplementItemCategory,
  type SupplementItemStatus,
  type SupplementLifecycle,
  type SupplementRecord,
} from './types';

const money = (n: number) => `$${n.toFixed(2)}`;

/** Maps a vision-detected evidence category to a supplement line category. */
function mapVisionCategory(v: string): SupplementItemCategory {
  const s = v.toUpperCase();
  if (s.includes('CLIP') || s.includes('FASTENER')) return 'CLIP_FASTENER';
  if (s.includes('MATERIAL')) return 'MATERIALS';
  if (s.includes('LABOR')) return 'PDR_LABOR';
  return 'PARTS';
}

function blankItem(): SupplementItem {
  return {
    id: genSupplementId('si'),
    description: '',
    category: 'PARTS',
    originalCost: 0,
    requestedCost: 0,
    status: 'PENDING',
    photoUrl: null,
  };
}

export interface SupplementDrawerProps {
  record: SupplementRecord | null;
  onClose: () => void;
  onSaved: (rec: SupplementRecord) => void;
}

export function SupplementDrawer({ record, onClose, onSaved }: SupplementDrawerProps) {
  const [roId, setRoId] = useState(record?.roId ?? '');
  const [customerName, setCustomerName] = useState(record?.customerName ?? '');
  const [vehicleInfo, setVehicleInfo] = useState(record?.vehicleInfo ?? '');
  const [insuranceCarrier, setInsuranceCarrier] = useState(record?.insuranceCarrier ?? '');
  const [claimNumber, setClaimNumber] = useState(record?.claimNumber ?? '');
  const [adjusterName, setAdjusterName] = useState(record?.adjusterName ?? '');
  const [adjusterPhone, setAdjusterPhone] = useState(record?.adjusterPhone ?? '');
  const [lifecycleStatus, setLifecycleStatus] = useState<SupplementLifecycle>(
    record?.lifecycleStatus ?? 'DRAFT',
  );
  const [carrierNotes, setCarrierNotes] = useState(record?.carrierNotes ?? '');
  const [items, setItems] = useState<SupplementItem[]>(
    record ? record.items.map((i) => ({ ...i })) : [blankItem()],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState<{ id: string; msg: string } | null>(null);

  const input =
    'w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40';

  const patchItem = (id: string, patch: Partial<SupplementItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const removeItem = (id: string) => setItems((prev) => prev.filter((it) => it.id !== id));
  const addItem = () => setItems((prev) => [...prev, blankItem()]);

  // Smart upload: attach the photo, then auto-tag + caption it via the vision
  // service, pre-filling the line item's category and description.
  const onPhotoFile = async (id: string, file: File | undefined) => {
    if (!file) return;
    patchItem(id, { photoUrl: URL.createObjectURL(file) });
    setCaption({ id, msg: 'Analyzing photo…' });
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('docType', 'SUPPLEMENT_EVIDENCE');
      const res = await fetch('/api/v1/vision/ocr', { method: 'POST', body: fd });
      const json = (await res.json()) as {
        success?: boolean;
        data?: Record<string, unknown>;
        provider?: string;
      };
      if (!json.success || !json.data) {
        setCaption({ id, msg: 'Could not auto-caption — edit manually.' });
        return;
      }
      const cap = typeof json.data.caption === 'string' ? json.data.caption : '';
      const cat = typeof json.data.category === 'string' ? json.data.category : '';
      const conf = typeof json.data.confidence === 'number' ? json.data.confidence : null;
      const mapped = mapVisionCategory(cat);
      const patch: Partial<SupplementItem> = { category: mapped };
      if (cap) patch.description = cap;
      patchItem(id, patch);
      setCaption({
        id,
        msg: `Auto-captioned as ${SUPPLEMENT_CATEGORY_LABEL[mapped]}${
          conf != null ? ` · ${Math.round(conf * 100)}% conf` : ''
        }${json.provider === 'mock' ? ' (sample)' : ''}.`,
      });
    } catch {
      setCaption({ id, msg: 'Auto-caption failed — edit manually.' });
    }
  };

  const draftRecord: SupplementRecord = {
    id: record?.id ?? '',
    roId,
    customerName,
    vehicleInfo,
    insuranceCarrier,
    claimNumber,
    lifecycleStatus,
    items,
    totalDeltaAmount: 0,
    carrierNotes,
    adjusterName: adjusterName.trim() || undefined,
    adjusterPhone: adjusterPhone.trim() || undefined,
    createdAt: record?.createdAt ?? '',
  };
  const totalDelta = computeTotalDelta(draftRecord);

  const save = async () => {
    if (!roId.trim()) return setError('RO id is required.');
    if (!customerName.trim()) return setError('Customer name is required.');
    if (items.length === 0) return setError('Add at least one line item.');
    setSaving(true);
    try {
      const rec: SupplementRecord = {
        ...draftRecord,
        id: record?.id ?? genSupplementId('sup'),
        createdAt: record?.createdAt ?? new Date().toISOString(),
      };
      const saved = await saveSupplement(rec);
      onSaved(saved);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={record ? 'Edit supplement' : 'New supplement'}
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-900 shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/95 p-4 backdrop-blur">
          <h2 className="text-base font-bold text-zinc-100">
            {record ? 'Edit Supplement' : 'New Supplement'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-3 p-4 text-sm">
          {/* Header fields */}
          <div className="grid grid-cols-2 gap-2">
            <input className={input} placeholder="RO id *" value={roId} onChange={(e) => setRoId(e.target.value)} />
            <input className={input} placeholder="Claim #" value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} />
            <input className={input} placeholder="Customer name *" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            <input className={input} placeholder="Insurance carrier" value={insuranceCarrier} onChange={(e) => setInsuranceCarrier(e.target.value)} />
            <input className={clsx(input, 'col-span-2')} placeholder="Vehicle (year make model)" value={vehicleInfo} onChange={(e) => setVehicleInfo(e.target.value)} />
            <input className={input} placeholder="Adjuster name" value={adjusterName} onChange={(e) => setAdjusterName(e.target.value)} />
            <input className={input} type="tel" placeholder="Adjuster phone" value={adjusterPhone} onChange={(e) => setAdjusterPhone(e.target.value)} />
          </div>

          <label className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              Lifecycle status
            </span>
            <select
              className={input}
              value={lifecycleStatus}
              onChange={(e) => setLifecycleStatus(e.target.value as SupplementLifecycle)}
            >
              {LIFECYCLE_ORDER.map((s) => (
                <option key={s} value={s} className="bg-zinc-900">
                  {LIFECYCLE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>

          {/* Line items */}
          <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
            <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              Line items
            </p>
            <span className="text-xs font-semibold tabular-nums text-emerald-300">
              Δ {money(totalDelta)}
            </span>
          </div>

          <div className="space-y-2">
            {items.map((it) => (
              <div key={it.id} className="space-y-1.5 rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
                <input
                  className={input}
                  placeholder="Description (e.g. hidden bumper clips, unpainted edge damage)"
                  value={it.description}
                  onChange={(e) => patchItem(it.id, { description: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    className={input}
                    value={it.category}
                    onChange={(e) =>
                      patchItem(it.id, { category: e.target.value as SupplementItemCategory })
                    }
                  >
                    {SUPPLEMENT_CATEGORIES.map((c) => (
                      <option key={c} value={c} className="bg-zinc-900">
                        {SUPPLEMENT_CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                  <select
                    className={input}
                    value={it.status}
                    onChange={(e) =>
                      patchItem(it.id, { status: e.target.value as SupplementItemStatus })
                    }
                  >
                    {SUPPLEMENT_ITEM_STATUSES.map((s) => (
                      <option key={s} value={s} className="bg-zinc-900">
                        {s}
                      </option>
                    ))}
                  </select>
                  <input
                    className={input}
                    inputMode="decimal"
                    placeholder="Original $"
                    value={it.originalCost || ''}
                    onChange={(e) => patchItem(it.id, { originalCost: parseFloat(e.target.value) || 0 })}
                  />
                  <input
                    className={input}
                    inputMode="decimal"
                    placeholder="Requested $"
                    value={it.requestedCost || ''}
                    onChange={(e) => patchItem(it.id, { requestedCost: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    className={input}
                    placeholder="Photo evidence URL"
                    value={it.photoUrl ?? ''}
                    onChange={(e) => patchItem(it.id, { photoUrl: e.target.value || null })}
                  />
                  <label className="shrink-0 cursor-pointer rounded bg-sky-600/80 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-sky-500">
                    📷 Auto-Caption
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => void onPhotoFile(it.id, e.target.files?.[0])}
                      className="hidden"
                    />
                  </label>
                </div>
                {caption?.id === it.id && (
                  <p className="text-[11px] text-sky-300">{caption.msg}</p>
                )}
                {it.photoUrl && (
                  <a href={it.photoUrl} target="_blank" rel="noreferrer" className="inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={it.photoUrl}
                      alt={`Evidence: ${it.description || it.category}`}
                      className="h-16 w-16 rounded border border-zinc-700 object-cover hover:border-sky-500/60"
                    />
                  </a>
                )}
                <div className="flex items-center justify-between text-[11px] text-zinc-500">
                  <span>
                    Δ {money((it.requestedCost || 0) - (it.originalCost || 0))}
                    {it.photoUrl ? ' · 📎 photo' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeItem(it.id)}
                    className="rounded border border-zinc-700 px-1.5 py-0.5 text-red-300 hover:bg-zinc-800"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addItem}
              className="w-full rounded-md border border-dashed border-zinc-700 px-2 py-1.5 text-[11px] font-medium text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            >
              + Add line item
            </button>
          </div>

          <textarea
            className={clsx(input, 'resize-none')}
            rows={2}
            placeholder="Carrier notes / status…"
            value={carrierNotes}
            onChange={(e) => setCarrierNotes(e.target.value)}
          />

          {error && <p className="text-[11px] text-red-300">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Supplement'}
          </button>
        </div>
      </aside>
    </div>
  );
}
