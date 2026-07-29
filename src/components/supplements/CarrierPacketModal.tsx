'use client';

/**
 * CarrierPacketModal — executive-ready adjuster transmittal / carrier packet.
 *
 * Renders a print-optimized (light-theme "paper") supplement document: shop
 * header, claim/vehicle info, itemized original-vs-requested cost table with
 * per-category rollup + delta totals, a photo evidence gallery, and an adjuster
 * sign-off block. A self-contained @media print block isolates the packet
 * (#carrier-packet) so window.print() / Save-as-PDF yields a pristine document.
 */
import {
  SUPPLEMENT_CATEGORIES,
  SUPPLEMENT_CATEGORY_LABEL,
  type SupplementItemCategory,
  type SupplementRecord,
} from './types';

const SHOP = {
  name: 'MESH Collision & PDR',
  address: '4820 Industrial Pkwy, Austin, TX 78744',
  phone: '(512) 555-0100',
  email: 'supplements@meshcollision.example',
};

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

const PRINT_CSS = `
@media print {
  @page { margin: 0.6in; }
  html, body { background: #ffffff !important; }
  body * { visibility: hidden !important; }
  #carrier-packet, #carrier-packet * { visibility: visible !important; }
  #carrier-packet {
    position: absolute !important;
    left: 0; top: 0; width: 100% !important;
    box-shadow: none !important; border: none !important;
  }
  .no-print { display: none !important; }
}
`;

export interface CarrierPacketModalProps {
  record: SupplementRecord;
  onClose: () => void;
}

export function CarrierPacketModal({ record, onClose }: CarrierPacketModalProps) {
  const items = record.items;
  const totalOriginal = items.reduce((s, i) => s + i.originalCost, 0);
  const totalRequested = items.reduce((s, i) => s + i.requestedCost, 0);
  const totalDelta = totalRequested - totalOriginal;

  const rollup = SUPPLEMENT_CATEGORIES.map((cat) => {
    const rows = items.filter((i) => i.category === cat);
    return {
      cat,
      count: rows.length,
      requested: rows.reduce((s, i) => s + i.requestedCost, 0),
      delta: rows.reduce((s, i) => s + (i.requestedCost - i.originalCost), 0),
    };
  }).filter((r) => r.count > 0);

  const photos = items.filter((i) => i.photoUrl);
  const dateStr = new Date(record.createdAt).toLocaleDateString();

  const cell = 'border border-zinc-300 px-2 py-1 text-left align-top';
  const num = 'border border-zinc-300 px-2 py-1 text-right tabular-nums';

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Carrier packet"
      onClick={onClose}
    >
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      {/* Toolbar (not printed) */}
      <div
        className="no-print mx-auto mb-3 flex max-w-4xl items-center justify-end gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
        >
          Print / Save as PDF
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-zinc-500 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
        >
          Close
        </button>
      </div>

      {/* The packet document */}
      <div
        id="carrier-packet"
        onClick={(e) => e.stopPropagation()}
        className="mx-auto max-w-4xl rounded-md bg-white p-8 text-sm text-zinc-900 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-zinc-800 pb-4">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">{SHOP.name}</h1>
            <p className="text-xs text-zinc-600">{SHOP.address}</p>
            <p className="text-xs text-zinc-600">
              {SHOP.phone} · {SHOP.email}
            </p>
          </div>
          <div className="text-right">
            <h2 className="text-lg font-bold uppercase tracking-wide text-zinc-800">
              Supplement Transmittal
            </h2>
            <p className="text-xs text-zinc-600">Adjuster Packet · {dateStr}</p>
            <p className="font-mono text-xs text-zinc-500">{record.id}</p>
          </div>
        </div>

        {/* Claim / vehicle info */}
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs sm:grid-cols-3">
          <Info label="Customer" value={record.customerName} />
          <Info label="Vehicle" value={record.vehicleInfo || '—'} />
          <Info label="RO #" value={record.roId} />
          <Info label="Insurance Carrier" value={record.insuranceCarrier || '—'} />
          <Info label="Claim #" value={record.claimNumber || '—'} />
          <Info label="Status" value={record.lifecycleStatus.replace(/_/g, ' ')} />
        </div>

        {/* Itemized table */}
        <h3 className="mt-6 mb-1.5 text-xs font-bold uppercase tracking-wider text-zinc-700">
          Itemized Supplement
        </h3>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-100">
              <th className={cell}>Category</th>
              <th className={cell}>Description</th>
              <th className={cell}>Status</th>
              <th className={num}>Original</th>
              <th className={num}>Requested</th>
              <th className={num}>Delta</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td className={cell}>{SUPPLEMENT_CATEGORY_LABEL[i.category]}</td>
                <td className={cell}>{i.description}</td>
                <td className={cell}>{i.status}</td>
                <td className={num}>{money(i.originalCost)}</td>
                <td className={num}>{money(i.requestedCost)}</td>
                <td className={num}>{money(i.requestedCost - i.originalCost)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-zinc-100 font-bold">
              <td className={cell} colSpan={3}>
                Total
              </td>
              <td className={num}>{money(totalOriginal)}</td>
              <td className={num}>{money(totalRequested)}</td>
              <td className={num}>{money(totalDelta)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Category rollup */}
        <h3 className="mt-6 mb-1.5 text-xs font-bold uppercase tracking-wider text-zinc-700">
          Category Rollup
        </h3>
        <table className="w-full max-w-md border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-100">
              <th className={cell}>Category</th>
              <th className={num}>Items</th>
              <th className={num}>Requested</th>
              <th className={num}>Delta</th>
            </tr>
          </thead>
          <tbody>
            {rollup.map((r) => (
              <tr key={r.cat}>
                <td className={cell}>{SUPPLEMENT_CATEGORY_LABEL[r.cat as SupplementItemCategory]}</td>
                <td className={num}>{r.count}</td>
                <td className={num}>{money(r.requested)}</td>
                <td className={num}>{money(r.delta)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Photo evidence gallery */}
        {photos.length > 0 && (
          <>
            <h3 className="mt-6 mb-1.5 text-xs font-bold uppercase tracking-wider text-zinc-700">
              Photo Evidence
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((i) => (
                <figure key={i.id} className="break-inside-avoid">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={i.photoUrl ?? ''}
                    alt={i.description}
                    className="h-32 w-full rounded border border-zinc-300 object-cover"
                  />
                  <figcaption className="mt-1 text-[10px] leading-tight text-zinc-600">
                    <span className="font-semibold">
                      {SUPPLEMENT_CATEGORY_LABEL[i.category]}
                    </span>{' '}
                    — {i.description}
                    <span className="block text-zinc-400">Captured {dateStr}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </>
        )}

        {/* Carrier notes */}
        {record.carrierNotes && (
          <div className="mt-6">
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-zinc-700">
              Carrier Notes
            </h3>
            <p className="text-xs text-zinc-700">{record.carrierNotes}</p>
          </div>
        )}

        {/* Adjuster sign-off */}
        <div className="mt-8 border-t border-zinc-300 pt-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-700">
            Adjuster Sign-Off &amp; Approval
          </h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-xs">
            <SignLine label="Adjuster Name" />
            <SignLine label="Approved Amount" />
            <SignLine label="Signature" />
            <SignLine label="Date" />
          </div>
          <div className="mt-4 flex gap-6 text-xs">
            <label className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 border border-zinc-500" /> Approved as submitted
            </label>
            <label className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 border border-zinc-500" /> Revised
            </label>
            <label className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 border border-zinc-500" /> Denied
            </label>
          </div>
          <p className="mt-4 text-[10px] text-zinc-400">
            Generated by {SHOP.name} · {record.id} · Total supplement delta {money(totalDelta)}.
          </p>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="font-medium text-zinc-900">{value}</p>
    </div>
  );
}

function SignLine({ label }: { label: string }) {
  return (
    <div>
      <div className="h-6 border-b border-zinc-400" />
      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
    </div>
  );
}
