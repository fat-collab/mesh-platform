'use client';

/**
 * RODrawerCommsSection — customer communication timeline for the RO Detail
 * Drawer. Shows the inbound/outbound comms log and a quick-action form to log
 * or simulate sending an outbound SMS / update. Backed by comms-db (DB-first
 * with a session-local fallback).
 */
import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { getCommEntries, addCommEntry } from '@/lib/comms-db';
import {
  COMM_CHANNEL_LABEL,
  COMM_DIRECTION_LABEL,
  type CommChannel,
  type RepairOrderCommEntry,
} from '@/components/ops/ro-comms-types';

const CHANNEL_TONE: Record<CommChannel, string> = {
  SMS: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  EMAIL: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
  PHONE: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  NOTE: 'border-zinc-600/60 bg-zinc-700/40 text-zinc-300',
};

const CHANNEL_ORDER: CommChannel[] = ['SMS', 'EMAIL', 'PHONE', 'NOTE'];

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export interface RODrawerCommsSectionProps {
  repairOrderId: string;
}

export function RODrawerCommsSection({ repairOrderId }: RODrawerCommsSectionProps) {
  const [open, setOpen] = useState(true);
  const [entries, setEntries] = useState<RepairOrderCommEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const [channel, setChannel] = useState<CommChannel>('SMS');
  const [recipient, setRecipient] = useState('');
  const [content, setContent] = useState('');

  const refresh = useCallback(async () => {
    setEntries(await getCommEntries(repairOrderId));
  }, [repairOrderId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const rows = await getCommEntries(repairOrderId);
      if (cancelled) return;
      setEntries(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [repairOrderId]);

  const handleSend = async () => {
    const body = content.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await addCommEntry({
        repairOrderId,
        channel,
        direction: 'OUTBOUND',
        recipient: recipient.trim() || undefined,
        content: body,
        senderName: 'Shop',
      });
      setContent('');
      await refresh();
    } finally {
      setSending(false);
    }
  };

  const inputCls =
    'rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40';

  const actionLabel = channel === 'SMS' || channel === 'EMAIL' || channel === 'PHONE' ? 'Send' : 'Log';

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Customer Comms{entries.length > 0 ? ` · ${entries.length}` : ''}
        </h3>
        <span className="text-zinc-500">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          {loading ? (
            <p className="text-xs text-zinc-500">Loading comms…</p>
          ) : entries.length === 0 ? (
            <p className="text-xs text-zinc-500">No communications logged yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className={clsx(
                    'rounded-md border px-2 py-1.5',
                    e.direction === 'INBOUND'
                      ? 'border-zinc-800 bg-zinc-900/60'
                      : 'border-sky-500/20 bg-sky-500/[0.04]',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={clsx(
                          'shrink-0 rounded border px-1 py-0.5 text-[10px] font-semibold',
                          CHANNEL_TONE[e.channel],
                        )}
                      >
                        {COMM_CHANNEL_LABEL[e.channel]}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                        {COMM_DIRECTION_LABEL[e.direction]}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                      {fmt(e.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-200">{e.content}</p>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                    {e.senderName || '—'}
                    {e.recipient ? ` → ${e.recipient}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {/* Quick action — log / send outbound */}
          <div className="space-y-2 border-t border-zinc-800 pt-3">
            <div className="grid grid-cols-[6rem_1fr] gap-2">
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as CommChannel)}
                aria-label="Channel"
                className={inputCls}
              >
                {CHANNEL_ORDER.map((c) => (
                  <option key={c} value={c} className="bg-zinc-900">
                    {COMM_CHANNEL_LABEL[c]}
                  </option>
                ))}
              </select>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Recipient (phone / email)"
                aria-label="Recipient"
                className={inputCls}
              />
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={2}
              placeholder="Message / note…"
              aria-label="Message"
              className={clsx(inputCls, 'w-full resize-none')}
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!content.trim() || sending}
              className="w-full rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
            >
              {sending ? 'Sending…' : `${actionLabel} ${COMM_CHANNEL_LABEL[channel]}`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
