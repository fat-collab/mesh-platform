'use client';

/**
 * KanbanBoard — the 8-stage Ops Cockpit drag board.
 *
 * Columns are droppables; cards are @dnd-kit/sortable items. Locked cards
 * (active hold gates) have their sortable disabled, so they cannot be dragged
 * out of their column until unlocked via the modal (business rule C).
 */
import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { clsx } from 'clsx';
import {
  STAGE_META,
  STAGE_ORDER,
  type BoardOrder,
  type StageTone,
} from '@/lib/board';
import type { RoStage } from '@/lib/database.types';
import { ROCard, ROCardView } from './ROCard';

const HEADER_TONE: Record<StageTone, { text: string; bar: string }> = {
  neutral: { text: 'text-zinc-300', bar: 'bg-zinc-600' },
  amber: { text: 'text-amber-300', bar: 'bg-amber-500' },
  red: { text: 'text-red-300', bar: 'bg-red-500' },
};

const DROPZONE_TONE: Record<StageTone, string> = {
  neutral: 'border-zinc-800',
  amber: 'border-amber-500/30 bg-amber-500/[0.03]',
  red: 'border-red-500/30 bg-red-500/[0.03]',
};

interface BoardColumnProps {
  stage: RoStage;
  orders: BoardOrder[];
  onRequestUnlock: (order: BoardOrder) => void;
  onSelect?: (order: BoardOrder) => void;
  onEdit?: (order: BoardOrder) => void;
}

function BoardColumn({ stage, orders, onRequestUnlock, onSelect, onEdit }: BoardColumnProps) {
  const meta = STAGE_META[stage];
  const tone = HEADER_TONE[meta.tone];
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const ids = useMemo(() => orders.map((o) => o.id), [orders]);

  return (
    <section className="flex w-72 shrink-0 flex-col">
      <header className="mb-2 flex items-center gap-2 px-1">
        <span className={clsx('h-2 w-2 rounded-full', tone.bar)} aria-hidden />
        <h2 className={clsx('text-sm font-semibold', tone.text)}>{meta.label}</h2>
        <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-400">
          {orders.length}
        </span>
      </header>

      <div
        ref={setNodeRef}
        className={clsx(
          'flex min-h-32 flex-1 flex-col gap-2 rounded-lg border border-dashed p-2 transition-colors',
          DROPZONE_TONE[meta.tone],
          isOver && 'border-solid ring-2 ring-sky-400/50',
        )}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {orders.map((order) => (
            <ROCard
              key={order.id}
              order={order}
              onRequestUnlock={onRequestUnlock}
              onSelect={onSelect}
              onEdit={onEdit}
            />
          ))}
        </SortableContext>

        {orders.length === 0 && (
          <p className="select-none px-1 py-6 text-center text-xs text-zinc-600">
            Drop here
          </p>
        )}
      </div>
    </section>
  );
}

export interface KanbanBoardProps {
  orders: BoardOrder[];
  onMove: (id: string, toStage: RoStage, claimNumber?: string) => void;
  onRequestUnlock: (order: BoardOrder) => void;
  onSelectOrder?: (order: BoardOrder) => void;
  onEditOrder?: (order: BoardOrder) => void;
}

export function KanbanBoard({
  orders,
  onMove,
  onRequestUnlock,
  onSelectOrder,
  onEditOrder,
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byStage = useMemo(() => {
    const groups = {} as Record<RoStage, BoardOrder[]>;
    for (const stage of STAGE_ORDER) groups[stage] = [];
    for (const order of orders) groups[order.stage]?.push(order);
    return groups;
  }, [orders]);

  const activeOrder = activeId
    ? orders.find((o) => o.id === activeId) ?? null
    : null;

  const resolveStage = (overId: UniqueIdentifier): RoStage | null => {
    const asStage = overId as RoStage;
    if (STAGE_ORDER.includes(asStage)) return asStage;
    // Dropped over another card — inherit that card's column.
    return orders.find((o) => o.id === overId)?.stage ?? null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const dragged = orders.find((o) => o.id === active.id);
    if (!dragged || dragged.hold_gate_active) return; // guard: locked can't move

    const destStage = resolveStage(over.id);
    if (!destStage || destStage === dragged.stage) return;

    onMove(dragged.id, destStage, dragged.claim_number ?? undefined);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGE_ORDER.map((stage) => (
          <BoardColumn
            key={stage}
            stage={stage}
            orders={byStage[stage]}
            onRequestUnlock={onRequestUnlock}
            onSelect={onSelectOrder}
            onEdit={onEditOrder}
          />
        ))}
      </div>

      <DragOverlay>
        {activeOrder ? (
          <ROCardView order={activeOrder} locked={false} overlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
