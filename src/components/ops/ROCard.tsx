import type { CSSProperties, MouseEvent, PointerEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { clsx } from 'clsx';
import {
  gateTypeForStage,
  isHoldStage,
  riskTone,
  type BoardOrder,
} from '@/lib/board';
import { HoldGateBadge, LockIcon } from './HoldGateBadge';

const RISK_TONE_CLASS: Record<'low' | 'medium' | 'high', string> = {
  low: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  high: 'border-red-500/40 bg-red-500/10 text-red-300',
};

function RiskBadge({ score }: { score: number }) {
  const tone = riskTone(score);
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
        RISK_TONE_CLASS[tone],
      )}
    >
      TL {score.toFixed(2)}
    </span>
  );
}

function formatTimestamp(ts?: string) {
  const asClockTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (!ts) {
    return asClockTime(new Date());
  }
  try {
    const date = new Date(ts);
    if (isNaN(date.getTime())) {
      return asClockTime(new Date());
    }
    return asClockTime(date);
  } catch {
    return asClockTime(new Date());
  }
}

interface ROCardViewProps {
  order: BoardOrder;
  locked: boolean;
  overlay?: boolean;
  dragging?: boolean;
  onRequestUnlock?: (order: BoardOrder) => void;
  onSelect?: (order: BoardOrder) => void;
  onEdit?: (order: BoardOrder) => void;
  setNodeRef?: (el: HTMLElement | null) => void;
  style?: CSSProperties;
  handleProps?: Record<string, unknown>;
}

export function ROCardView({
  order,
  locked,
  overlay = false,
  dragging = false,
  onRequestUnlock,
  onSelect,
  onEdit,
  setNodeRef,
  style,
  handleProps,
}: ROCardViewProps) {
  const gateType = gateTypeForStage(order.stage);
  const inHoldStage = isHoldStage(order.stage);

  const handleDetailsClick = (e: MouseEvent | PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onSelect) {
      onSelect(order);
    } else {
      console.warn('[ROCard] onSelect callback is missing on card:', order.id);
    }
  };

  const handleEditClick = (e: MouseEvent | PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onEdit?.(order);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'group relative rounded-lg border p-3 text-left shadow-sm transition-colors',
        'border-zinc-700/70 bg-zinc-800/80 hover:border-sky-500/50 hover:bg-zinc-800/90',
        locked
          ? 'ring-1 ring-inset ring-amber-500/20'
          : 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
        overlay && 'cursor-grabbing rotate-1 shadow-xl ring-1 ring-sky-400/40',
      )}
      {...(!locked && handleProps ? handleProps : {})}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-sky-300">
          {order.claim_number ?? 'NO CLAIM'}
        </span>
        {order.risk_score != null && <RiskBadge score={order.risk_score} />}
      </div>

      <p className="mt-1 truncate text-sm font-semibold text-zinc-100">
        {order.vehicle}
        {order.aluminum && (
          <span className="ml-1.5 align-middle text-[10px] font-medium uppercase text-zinc-400">
            AL
          </span>
        )}
      </p>
      <p className="truncate text-xs text-zinc-400">
        {order.customer_name ?? 'Unknown customer'}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-zinc-500">{order.location}</p>
      {order.assignedStaffName && (
        <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-zinc-400">
          <span aria-hidden>👤</span>
          <span className="truncate">{order.assignedStaffName}</span>
        </p>
      )}

      {(locked || inHoldStage) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {locked && gateType ? (
            <HoldGateBadge gateType={gateType} />
          ) : (
            inHoldStage && (
              <span className="inline-flex items-center gap-1 rounded-md border border-zinc-600/60 bg-zinc-700/40 px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
                Gate resolved
              </span>
            )
          )}
        </div>
      )}

      {/* Timestamp & Isolated Click Trigger */}
      <div className="mt-3 flex items-center justify-between border-t border-zinc-700/50 pt-2 text-[10px]">
        <span className="font-mono text-zinc-400">
          🕒 {formatTimestamp(order.updated_at || order.created_at)}
        </span>
        <div className="flex items-center gap-1.5">
          {onEdit && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleEditClick}
              className="relative z-20 cursor-pointer rounded border border-zinc-700 px-2 py-1 font-sans font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 active:scale-95"
            >
              ✎ Edit
            </button>
          )}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleDetailsClick}
            className="relative z-20 cursor-pointer rounded bg-sky-500/20 px-2 py-1 font-sans font-semibold text-sky-300 hover:bg-sky-500/30 hover:text-sky-200 active:scale-95"
          >
            Details →
          </button>
        </div>
      </div>

      {locked && onRequestUnlock && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRequestUnlock(order);
          }}
          className="relative z-20 mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/20"
        >
          <LockIcon className="h-3.5 w-3.5" />
          Unlock gate
        </button>
      )}
    </div>
  );
}

export interface ROCardProps {
  order: BoardOrder;
  onRequestUnlock: (order: BoardOrder) => void;
  onSelect?: (order: BoardOrder) => void;
  onEdit?: (order: BoardOrder) => void;
}

export function ROCard({ order, onRequestUnlock, onSelect, onEdit }: ROCardProps) {
  const locked = order.hold_gate_active;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: order.id,
    data: { stage: order.stage },
    disabled: locked,
  });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <ROCardView
      order={order}
      locked={locked}
      dragging={isDragging}
      onRequestUnlock={onRequestUnlock}
      onSelect={onSelect}
      onEdit={onEdit}
      setNodeRef={setNodeRef}
      style={style}
      handleProps={{ ...attributes, ...listeners }}
    />
  );
}
