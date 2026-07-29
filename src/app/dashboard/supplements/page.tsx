'use client';

/**
 * Supplements — insurance supplement & photo audit command center.
 *
 * Active claims, dollars in limbo (submitted/unpaid), and aging alerts, with a
 * create/edit drawer for line-item categorization + photo evidence and carrier
 * lifecycle tracking.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import type { AuditChannel, AuditLogEntry } from '@/lib/audit/types';
import {
  deleteSupplement,
  getSupplements,
  saveSupplement,
  supplementAgingDays,
  updateSupplementStatus,
} from '@/lib/supplement-db';
import { SupplementDrawer } from '@/components/supplements/SupplementDrawer';
import { CarrierPacketModal } from '@/components/supplements/CarrierPacketModal';
import { CarrierTierBadge } from '@/components/carrier/CarrierTierBadge';
import {
  LIFECYCLE_LABEL,
  LIFECYCLE_ORDER,
  UNPAID_LIFECYCLE,
  type SupplementLifecycle,
  type SupplementRecord,
} from '@/components/supplements/types';

const AGING_THRESHOLD_DAYS = 14;

// Placeholder carrier/adjuster line — real records don't yet store an adjuster
// phone; swap for a per-claim number when that field exists.
const DEMO_ADJUSTER_LINE = '+15125550100';

const CHANNEL_ICON: Record<AuditChannel, string> = {
  VAPI_CALL: '📞',
  SMS: '💬',
  EMAIL: '✉️',
  SYSTEM: '⚙️',
};

function AuditTimeline({ recordKey }: { recordKey: string }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/audit/${encodeURIComponent(recordKey)}`);
      const json = (await res.json()) as { entries?: AuditLogEntry[] };
      setEntries(Array.isArray(json.entries) ? json.entries : []);
    } catch {
      /* keep prior entries on transient error */
    } finally {
      setLoading(false);
    }
  }, [recordKey]);

  // Fetch on open + poll so live webhook callbacks render without a restart.
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (loading && entries.length === 0) {
    return <p className="text-xs text-zinc-500">Loading timeline…</p>;
  }

  return (
    <>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[10px] font-medium text-zinc-300 hover:bg-zinc-800"
        >
          ↻ Refresh
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-zinc-500">No communication logged yet.</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((e) => (
        <li key={e.id} className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden>{CHANNEL_ICON[e.channel] ?? '•'}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {e.channel.replace('_', ' ')} · {e.direction}
            </span>
            <span className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
              {e.status}
            </span>
            <span className="ml-auto font-mono text-[10px] text-zinc-500">
              {new Date(e.timestamp).toLocaleString()}
            </span>
          </div>
          <p className="mt-1 text-zinc-200">{e.summary}</p>
          {e.author && <p className="text-[10px] text-zinc-500">— {e.author}</p>}
          {e.transcript && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-sky-300">View transcript</summary>
              <pre className="mt-1 whitespace-pre-wrap rounded bg-zinc-950/70 p-2 text-[10px] text-zinc-400">
                {e.transcript}
              </pre>
            </details>
          )}
        </li>
          ))}
        </ol>
      )}
    </>
  );
}

const LIFECYCLE_TONE: Record<SupplementLifecycle, string> = {
  DRAFT: 'border-zinc-600/60 bg-zinc-700/40 text-zinc-200',
  SUBMITTED: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  APPROVED_PENDING_PAYMENT: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  PAID: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
};

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function nextLifecycle(current: SupplementLifecycle): SupplementLifecycle | null {
  const i = LIFECYCLE_ORDER.indexOf(current);
  return i >= 0 && i < LIFECYCLE_ORDER.length - 1 ? LIFECYCLE_ORDER[i + 1] : null;
}

export default function SupplementsPage() {
  const [records, setRecords] = useState<SupplementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ open: boolean; record: SupplementRecord | null }>({
    open: false,
    record: null,
  });
  const [packet, setPacket] = useState<SupplementRecord | null>(null);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [callMsg, setCallMsg] = useState<string | null>(null);
  const [openLogId, setOpenLogId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setRecords(await getSupplements());
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
        const rows = await getSupplements();
        if (cancelled) return;
        setRecords(rows);
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
    const onFocus = () => void refetch();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refetch]);

  const metrics = useMemo(() => {
    const now = Date.now();
    const active = records.filter((r) => r.lifecycleStatus !== 'PAID');
    const limbo = records
      .filter((r) => UNPAID_LIFECYCLE.includes(r.lifecycleStatus))
      .reduce((s, r) => s + r.totalDeltaAmount, 0);
    const aging = records.filter(
      (r) =>
        UNPAID_LIFECYCLE.includes(r.lifecycleStatus) &&
        supplementAgingDays(r.createdAt, now) >= AGING_THRESHOLD_DAYS,
    ).length;
    return { active: active.length, limbo, aging };
  }, [records]);

  const advance = async (r: SupplementRecord) => {
    const next = nextLifecycle(r.lifecycleStatus);
    if (!next) return;
    setRecords((prev) =>
      prev.map((x) => (x.id === r.id ? { ...x, lifecycleStatus: next } : x)),
    );
    await updateSupplementStatus(r.id, next);
  };

  const remove = async (id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    await deleteSupplement(id);
  };

  const updateAdjusterPhone = (id: string, phone: string) =>
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, adjusterPhone: phone } : r)));

  const persistAdjuster = (id: string) => {
    setRecords((prev) => {
      const rec = prev.find((r) => r.id === id);
      if (rec) void saveSupplement(rec);
      return prev;
    });
  };

  const dispatchCall = async (r: SupplementRecord) => {
    const phone = r.adjusterPhone?.trim() || DEMO_ADJUSTER_LINE;
    const usingDemo = !r.adjusterPhone?.trim();
    setDispatchingId(r.id);
    setCallMsg(null);
    try {
      const res = await fetch('/api/v1/vapi/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phone,
          claimId: r.claimNumber || r.roId,
          objective: 'FOLLOW_UP_SUPPLEMENT',
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        callId?: string;
        provider?: string;
        error?: string;
      };
      if (json.success) {
        setCallMsg(
          `📞 AI follow-up dispatched to ${r.adjusterName ? `${r.adjusterName} · ` : ''}${phone}${
            usingDemo ? ' (demo line)' : ''
          } for ${r.claimNumber || r.roId} (${json.provider}${
            json.callId ? ` · ${json.callId}` : ''
          }).`,
        );
      } else {
        setCallMsg(`Call failed: ${json.error ?? 'unknown error'}.`);
      }
    } catch {
      setCallMsg('Call dispatch failed.');
    } finally {
      setDispatchingId(null);
    }
  };

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Supplements &amp; Photo Audit</h1>
            <p className="text-sm text-zinc-400">Carrier supplement claims &amp; aging tracking</p>
          </div>
          <button
            type="button"
            onClick={() => setDrawer({ open: true, record: null })}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
          >
            + New Supplement
          </button>
        </header>

        {callMsg && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm text-violet-200">
            <span>{callMsg}</span>
            <button
              type="button"
              onClick={() => setCallMsg(null)}
              className="text-violet-300/70 hover:text-violet-200"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {/* Metrics */}
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Metric label="Active Supplement Claims" value={String(metrics.active)} />
          <Metric label="Dollars in Limbo" value={money(metrics.limbo)} tone="text-amber-300" sub="Submitted / approved-unpaid" />
          <Metric
            label="Aging Alerts"
            value={String(metrics.aging)}
            tone={metrics.aging > 0 ? 'text-red-300' : 'text-zinc-100'}
            sub={`≥ ${AGING_THRESHOLD_DAYS} days outstanding`}
          />
        </div>

        {error ? (
          <div className="p-4 bg-red-950/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
            ⚠️ Error loading supplements: {error}
          </div>
        ) : loading ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
            Loading supplements…
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/60 text-[11px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-mono">RO / Claim</th>
                  <th className="px-3 py-2 font-mono">Customer / Vehicle</th>
                  <th className="px-3 py-2 font-mono">Carrier</th>
                  <th className="px-3 py-2 font-mono">Status</th>
                  <th className="px-3 py-2 font-mono">Items</th>
                  <th className="px-3 py-2 font-mono">Δ Amount</th>
                  <th className="px-3 py-2 font-mono">Age</th>
                  <th className="px-3 py-2 font-mono">Evidence</th>
                  <th className="px-3 py-2 font-mono">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const age = supplementAgingDays(r.createdAt);
                  const aging =
                    UNPAID_LIFECYCLE.includes(r.lifecycleStatus) && age >= AGING_THRESHOLD_DAYS;
                  const next = nextLifecycle(r.lifecycleStatus);
                  return (
                    <Fragment key={r.id}>
                    <tr className="border-b border-zinc-800/60">
                      <td className="px-3 py-2">
                        <div className="font-medium text-zinc-100">{r.roId}</div>
                        <div className="font-mono text-[11px] text-zinc-500">{r.claimNumber}</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-300">
                        {r.customerName}
                        <span className="block text-[11px] text-zinc-500">{r.vehicleInfo}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-300">
                        {r.insuranceCarrier}
                        <CarrierTierBadge carrier={r.insuranceCarrier} className="mt-1" />
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={clsx(
                            'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold',
                            LIFECYCLE_TONE[r.lifecycleStatus],
                          )}
                        >
                          {LIFECYCLE_LABEL[r.lifecycleStatus]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums text-zinc-400">{r.items.length}</td>
                      <td className="px-3 py-2 text-xs font-semibold tabular-nums text-emerald-300">
                        {money(r.totalDeltaAmount)}
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums">
                        <span className={aging ? 'font-semibold text-red-300' : 'text-zinc-400'}>
                          {age}d{aging ? ' ⚠' : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {(() => {
                          const photos = r.items.filter((i) => i.photoUrl);
                          if (photos.length === 0)
                            return <span className="text-zinc-600">—</span>;
                          return (
                            <div className="flex items-center gap-1">
                              {photos.slice(0, 3).map((i) => (
                                <a
                                  key={i.id}
                                  href={i.photoUrl ?? undefined}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={i.description}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={i.photoUrl ?? ''}
                                    alt={i.description}
                                    className="h-8 w-8 rounded border border-zinc-700 object-cover hover:border-sky-500/60"
                                  />
                                </a>
                              ))}
                              {photos.length > 3 && (
                                <span className="text-[10px] text-zinc-500">
                                  +{photos.length - 3}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDrawer({ open: true, record: r })}
                            className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setPacket(r)}
                            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20"
                          >
                            Export Carrier Packet
                          </button>
                          <input
                            type="tel"
                            value={r.adjusterPhone ?? ''}
                            onChange={(e) => updateAdjusterPhone(r.id, e.target.value)}
                            onBlur={() => persistAdjuster(r.id)}
                            placeholder="Adjuster #"
                            aria-label={`Adjuster phone for ${r.claimNumber || r.roId}`}
                            className="w-24 rounded border border-zinc-700 bg-zinc-950/70 px-1.5 py-0.5 text-[11px] text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => void dispatchCall(r)}
                            disabled={dispatchingId === r.id}
                            className="rounded border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-300 hover:bg-violet-500/20 disabled:opacity-50"
                          >
                            {dispatchingId === r.id ? 'Dispatching…' : '📞 Dispatch AI Call'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setOpenLogId((cur) => (cur === r.id ? null : r.id))
                            }
                            aria-expanded={openLogId === r.id}
                            className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800"
                          >
                            🕓 Timeline
                          </button>
                          {next && (
                            <button
                              type="button"
                              onClick={() => void advance(r)}
                              className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300 hover:bg-sky-500/20"
                            >
                              → {LIFECYCLE_LABEL[next]}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void remove(r.id)}
                            className="rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-300 hover:bg-red-500/20"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    {openLogId === r.id && (
                      <tr className="border-b border-zinc-800/60 bg-zinc-950/40">
                        <td colSpan={9} className="px-3 py-3">
                          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                            Audit &amp; Communication Timeline
                          </p>
                          <AuditTimeline recordKey={r.claimNumber || r.roId} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawer.open && (
        <SupplementDrawer
          key={drawer.record?.id ?? 'new'}
          record={drawer.record}
          onClose={() => setDrawer({ open: false, record: null })}
          onSaved={() => {
            setDrawer({ open: false, record: null });
            void refetch();
          }}
        />
      )}

      {packet && (
        <CarrierPacketModal record={packet} onClose={() => setPacket(null)} />
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={clsx('mt-1 text-2xl font-bold tabular-nums', tone ?? 'text-zinc-100')}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}
