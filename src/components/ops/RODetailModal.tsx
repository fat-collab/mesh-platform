'use client';

import { useEffect } from 'react';
import { gateTypeForStage, type BoardOrder } from '@/lib/board';
import { LockIcon } from './HoldGateBadge';

interface RODetailModalProps {
  order: BoardOrder | null;
  onClose: () => void;
  onRequestUnlock?: (order: BoardOrder) => void;
}

export function RODetailModal({ order, onClose, onRequestUnlock }: RODetailModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!order) return null;

  const gateType = gateTypeForStage(order.stage);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-800 pb-4">
          <div>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-sky-400">
              {order.claim_number ?? 'NO CLAIM NUMBER'}
            </span>
            <h2 className="mt-1 text-lg font-bold text-zinc-100">{order.vehicle}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        {/* Body Details */}
        <div className="mt-4 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">Customer</p>
              <p className="mt-0.5 font-medium text-zinc-200">{order.customer_name ?? 'N/A'}</p>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">Location</p>
              <p className="mt-0.5 font-medium text-zinc-200">{order.location ?? 'Main Shop'}</p>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">Stage</p>
              <p className="mt-0.5 font-semibold capitalize text-sky-300">
                {order.stage ? order.stage.replace(/_/g, ' ') : 'N/A'}
              </p>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">Aluminum Body</p>
              <p className="mt-0.5 font-medium text-zinc-200">
                {order.aluminum ? 'Yes (Specialized Bay)' : 'Standard'}
              </p>
            </div>
          </div>

          {/* Gate Status */}
          <div>
            <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              Hold Gate Status
            </p>
            {order.hold_gate_active ? (
              <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
                <div className="flex items-center gap-2">
                  <LockIcon className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-semibold">Hold Gate Active ({gateType})</span>
                </div>
                {onRequestUnlock && (
                  <button
                    type="button"
                    onClick={() => onRequestUnlock(order)}
                    className="rounded border border-amber-500/40 bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-500/30"
                  >
                    Unlock
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs font-medium text-emerald-300">
                ✓ Gate Clear / Operational
              </div>
            )}
          </div>

          {/* Timestamps */}
          <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-400">
            <div className="flex justify-between">
              <span className="font-mono text-zinc-500">Order ID:</span>
              <span className="font-mono text-zinc-300">{order.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-mono text-zinc-500">Created At:</span>
              <span className="text-zinc-300">
                {order.created_at ? new Date(order.created_at).toLocaleString() : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="font-mono text-zinc-500">Last Updated:</span>
              <span className="font-medium text-sky-300">
                {order.updated_at ? new Date(order.updated_at).toLocaleString() : 'N/A'}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
