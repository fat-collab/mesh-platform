'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isHoldStage, riskTone, type BoardOrder } from '@/lib/board';
import type { Database, RoStage } from '@/lib/database.types';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getCurrentProfile } from '@/lib/auth';
import {
  fetchBoardOrders,
  persistStage,
  persistUnlock,
  persistRepairOrder,
  createManualIntake,
} from '@/lib/ops-data';
import { validateStageTransition } from '@/lib/stage-gates';
import {
  EditRepairOrderModal,
  type EditRepairOrderPatch,
} from '@/components/ops/EditRepairOrderModal';
import { NewIntakeModal, type NewIntakePayload } from '@/components/ops/NewIntakeModal';
import type { ShopConfig, StaffMember } from '@/components/onboarding/types';
import { MOCK_BOARD_ORDERS, MOCK_PARTS_BY_CLAIM } from '@/lib/ops-mock';
import { KanbanBoard } from '@/components/ops/KanbanBoard';
import { UnlockGateModal } from '@/components/ops/UnlockGateModal';
import { RODetailDrawer } from '@/components/ops/RODetailDrawer';
import { BoardToolbar, type BoardFilter } from '@/components/ops/BoardToolbar';
import { AuditHistoryView } from '@/components/ops/AuditHistoryView';

/** Raw repair_orders row as delivered by Supabase Realtime (no joins). */
type RepairOrderRow = Database['public']['Tables']['repair_orders']['Row'];

type Source = 'supabase' | 'sample';
type LoadState = 'loading' | 'ready';

export default function OpsCockpitPage() {
  const [orders, setOrders] = useState<BoardOrder[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [source, setSource] = useState<Source>('sample');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlockTarget, setUnlockTarget] = useState<BoardOrder | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<BoardOrder | null>(null);
  const [editTarget, setEditTarget] = useState<BoardOrder | null>(null);
  const [newIntakeOpen, setNewIntakeOpen] = useState(false);
  const [staffRoster, setStaffRoster] = useState<StaffMember[]>([]);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<BoardFilter>('all');
  const [view, setView] = useState<'board' | 'audit'>('board');

  // Shop's configured staff roster — fetched once, powers each card's
  // quick-assign dropdown so assignment picks a real staff member, not free text.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/shop/config');
        const json = (await res.json()) as { config?: ShopConfig | null };
        if (!cancelled && json.config?.staff) setStaffRoster(json.config.staff);
      } catch {
        /* no configured roster yet — quick-assign stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setError(null);
        const supabase = getSupabaseBrowserClient();
        const { orders: rows, error } = await fetchBoardOrders(supabase);
        if (cancelled) return;

        if (!error && rows.length > 0) {
          setOrders(rows);
          setSource('supabase');
        } else {
          setOrders(MOCK_BOARD_ORDERS);
          setSource('sample');
          if (error) setNotice(`Supabase unavailable — showing sample data.`);
        }
      } catch (err: unknown) {
        // Hard failure (e.g. DB throws in production) — surface it inline.
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Data sync failed');
      } finally {
        if (!cancelled) setLoadState('ready');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh-safe bridge sync — when the tab/window regains focus, merge in any
  // newly bridged intake ROs (e.g. from a completed mobile intake) without
  // clobbering existing cards' optimistic drag/unlock state.
  useEffect(() => {
    const sync = async () => {
      let list: BoardOrder[] = MOCK_BOARD_ORDERS;
      if (source === 'supabase') {
        const supabase = getSupabaseBrowserClient();
        const { orders: rows, error } = await fetchBoardOrders(supabase);
        if (!error) list = rows;
      }
      setOrders((prev) => {
        const known = new Set(prev.map((o) => o.id));
        const additions = list.filter((o) => !known.has(o.id));
        return additions.length > 0 ? [...prev, ...additions] : prev;
      });
    };
    const onFocus = () => void sync();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [source]);

  // Real-time board sync — reflect INSERT/UPDATE/DELETE on the orders table
  // from any session into local state so cards re-render immediately across
  // open browser tabs. Subscribes only when backed by Supabase (sample data
  // has nothing to sync); the channel is torn down on unmount / source change.
  useEffect(() => {
    if (source !== 'supabase') return;

    const supabase = getSupabaseBrowserClient();

    // Merge a raw realtime row into a board card, preserving already-joined
    // display fields (vehicle / location / risk_score) when one exists.
    const toBoardOrder = (
      row: RepairOrderRow,
      existing?: BoardOrder,
    ): BoardOrder => ({
      ...(existing ?? { vehicle: 'Unknown vehicle', location: '—', risk_score: null }),
      id: row.id,
      claim_number: row.claim_number,
      customer_name: row.customer_name,
      stage: row.stage,
      hold_gate_active: row.hold_gate_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });

    const channel = supabase
      .channel('board_orders_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'repair_orders' },
        (payload: RealtimePostgresChangesPayload<RepairOrderRow>) => {
          setOrders((prev) => {
            switch (payload.eventType) {
              case 'INSERT':
              case 'UPDATE': {
                const row = payload.new as RepairOrderRow;
                const existing = prev.find((o) => o.id === row.id);
                const merged = toBoardOrder(row, existing);
                return existing
                  ? prev.map((o) => (o.id === row.id ? merged : o))
                  : [...prev, merged];
              }
              case 'DELETE': {
                const removedId = (payload.old as Partial<RepairOrderRow>).id;
                return removedId ? prev.filter((o) => o.id !== removedId) : prev;
              }
              default:
                return prev;
            }
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [source]);

  const handleMove = useCallback(
    (id: string, toStage: RoStage, claimNumber?: string) => {
      void (async () => {
        // (b) Stage-gate enforcement — block invalid transitions before any
        // optimistic move. Not allowed → surface the exact blocker and bail,
        // leaving the card in its current column. The claim number lets the
        // financial-clearance gate match carrier supplements by claim.
        const gate = await validateStageTransition(id, toStage, claimNumber);
        if (!gate.allowed) {
          setNotice(gate.reason ?? 'Transition blocked by a stage gate.');
          return;
        }

        const movedAt = new Date().toISOString();
        let snapshot: BoardOrder[] = [];

        // (c) Optimistic update — the card jumps to the target column instantly.
        // hold_gate_active is mirrored locally to match the DB trigger, and
        // updated_at is refreshed so the card's timestamp reflects the move.
        setOrders((prev) => {
          snapshot = prev;
          return prev.map((o) =>
            o.id === id
              ? {
                  ...o,
                  stage: toStage,
                  hold_gate_active: isHoldStage(toStage),
                  updated_at: movedAt,
                }
              : o,
          );
        });

        if (source !== 'supabase') return;

        // (d/e) Persist; on failure revert to the pre-move snapshot and alert.
        const supabase = getSupabaseBrowserClient();
        const { error } = await persistStage(supabase, id, toStage, movedAt);
        if (error) {
          setOrders(snapshot);
          setNotice(`Could not move order: ${error}`);
        }
      })();
    },
    [source],
  );

  const handleConfirmUnlock = useCallback(
    (order: BoardOrder, reason: string) => {
      const id = order.id;
      const resolvedAt = new Date().toISOString();
      let snapshot: BoardOrder[] = [];
      setUnlockBusy(true);

      // Optimistic: clear the gate and refresh updated_at so the card unlocks
      // (regaining its drag handle) instantly.
      setOrders((prev) => {
        snapshot = prev;
        return prev.map((o) =>
          o.id === id
            ? { ...o, hold_gate_active: false, updated_at: resolvedAt }
            : o,
        );
      });

      const finish = () => {
        setUnlockBusy(false);
        setUnlockTarget(null);
      };

      if (source !== 'supabase') {
        finish();
        return;
      }

      void (async () => {
        const supabase = getSupabaseBrowserClient();
        const { error } = await persistUnlock(supabase, id, reason, resolvedAt);
        if (error) {
          setOrders(snapshot);
          setNotice(`Could not resolve gate: ${error}`);
        }
        finish();
      })();
    },
    [source],
  );

  // Re-pull the board from its source of truth after a mutating save.
  const refetchBoard = useCallback(async () => {
    if (source === 'supabase') {
      const supabase = getSupabaseBrowserClient();
      const { orders: rows, error } = await fetchBoardOrders(supabase);
      if (!error) setOrders(rows);
    } else {
      setOrders([...MOCK_BOARD_ORDERS]);
    }
  }, [source]);

  // Manual Ops intake creation (incl. "Pull from Sales"). DB-first: provisions
  // a real vehicle + repair_order when possible; otherwise falls back to the
  // shared local board so the new intake is still visible immediately.
  const handleCreateIntake = useCallback(
    async (payload: NewIntakePayload) => {
      const now = new Date().toISOString();

      if (source === 'supabase') {
        const supabase = getSupabaseBrowserClient();
        const profile = await getCurrentProfile(supabase);
        if (profile?.organizationId) {
          const { id, error } = await createManualIntake(supabase, {
            organizationId: profile.organizationId,
            customerName: payload.customerName,
            vehicle: payload.vehicle,
            vin: payload.vin || null,
            claimNumber: payload.claimNumber || null,
            insuranceCarrier: payload.insuranceCarrier || null,
            intakeNotes: payload.intakeNotes || null,
          });
          if (!error) {
            await refetchBoard();
            setNotice(`Repair order created for ${payload.customerName}.`);
            return;
          }
          setNotice(`Could not save to Supabase (${error}) — added to local board instead.`);
        }
      }

      // Local fallback — mirrors the shared MOCK_BOARD_ORDERS bridge shape.
      const id = `manual-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
      const newOrder: BoardOrder = {
        id,
        claim_number: payload.claimNumber || null,
        customer_name: payload.customerName,
        vehicle: payload.vehicle,
        vin: payload.vin || null,
        location: 'Intake',
        stage: 'INTAKE',
        hold_gate_active: false,
        risk_score: null,
        created_at: now,
        updated_at: now,
        insuranceCarrier: payload.insuranceCarrier || null,
        intakeNotes: payload.intakeNotes || null,
      };
      MOCK_BOARD_ORDERS.push(newOrder);
      setOrders((prev) => [...prev, newOrder]);
    },
    [source, refetchBoard],
  );

  // Edit save: optimistic patch, then persist (Supabase) + refetch, or mutate
  // the shared mock board (sample mode) so the change survives across views.
  const handleEditSave = useCallback(
    async (patch: EditRepairOrderPatch) => {
      const target = editTarget;
      if (!target) return;
      const id = target.id;
      const updatedAt = new Date().toISOString();

      const applyPatch = (o: BoardOrder): BoardOrder => ({
        ...o,
        customer_name: patch.customerName,
        claim_number: patch.claimNumber,
        stage: patch.stage,
        hold_gate_active: isHoldStage(patch.stage),
        targetDeliveryDate: patch.targetDeliveryDate,
        updated_at: updatedAt,
      });

      setOrders((prev) => prev.map((o) => (o.id === id ? applyPatch(o) : o)));
      // Keep an already-open drawer in sync (e.g. FleetRentalTracker's ETA).
      setSelectedOrder((prev) => (prev && prev.id === id ? applyPatch(prev) : prev));

      if (source === 'supabase') {
        const supabase = getSupabaseBrowserClient();
        const { error } = await persistRepairOrder(
          supabase,
          id,
          {
            customer_name: patch.customerName,
            claim_number: patch.claimNumber,
            stage: patch.stage,
            target_delivery_date: patch.targetDeliveryDate,
          },
          updatedAt,
        );
        if (error) setNotice(`Could not save order: ${error}`);
        await refetchBoard();
      } else {
        const mock = MOCK_BOARD_ORDERS.find((o) => o.id === id);
        if (mock) {
          mock.customer_name = patch.customerName;
          mock.claim_number = patch.claimNumber;
          mock.stage = patch.stage;
          mock.hold_gate_active = isHoldStage(patch.stage);
          mock.targetDeliveryDate = patch.targetDeliveryDate;
          mock.updated_at = updatedAt;
        }
      }
    },
    [editTarget, source, refetchBoard],
  );

  const holdCount = orders.filter((o) => o.hold_gate_active).length;

  // Client-side search + quick-filter, applied before the board groups cards
  // into stage columns — so the stage header counters reflect these totals.
  const filteredOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      switch (filter) {
        case 'holds':
          if (!o.hold_gate_active) return false;
          break;
        case 'parts':
          // "Parts Delay / Ordering": the parts-backorder hold stage.
          if (o.stage !== 'HOLD_PARTS') return false;
          break;
        case 'high_risk':
          // "High Risk / Total Loss": a high risk score OR the total-loss gate.
          if (
            !(o.risk_score != null && riskTone(o.risk_score) === 'high') &&
            o.stage !== 'HOLD_TOTAL_LOSS'
          ) {
            return false;
          }
          break;
        case 'aluminum':
          if (!o.aluminum) return false;
          break;
        case 'all':
        default:
          break;
      }

      if (q) {
        const vin = (o.vin ?? '').toLowerCase();
        // Case-insensitive match across VIN (full or last-8 digits), claim #,
        // customer, and vehicle. Full-VIN substring already covers the last 8;
        // the explicit tail token keeps that common lookup pattern first-class.
        const tokens = [
          o.claim_number,
          o.customer_name,
          o.vehicle,
          vin,
          vin.slice(-8),
        ];
        const haystack = tokens.filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [orders, query, filter]);

  const clearFilters = () => {
    setQuery('');
    setFilter('all');
  };

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Ops Cockpit</h1>
            <p className="text-sm text-zinc-400">
              8-stage repair board · {orders.length} orders ·{' '}
              <span className={holdCount > 0 ? 'text-amber-300' : 'text-zinc-400'}>
                {holdCount} on hold
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={
                source === 'supabase'
                  ? 'rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300'
                  : 'rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-400'
              }
            >
              {source === 'supabase' ? 'Live · Supabase' : 'Sample data'}
            </span>
            <button
              type="button"
              onClick={() => setNewIntakeOpen(true)}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
            >
              + New Intake
            </button>
          </div>
        </header>

        {/* View toggle */}
        <div className="mb-4 inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5">
          {(
            [
              { id: 'board', label: 'Live Kanban Board' },
              { id: 'audit', label: 'Audit History & Gate Logs' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              aria-pressed={view === tab.id}
              className={
                view === tab.id
                  ? 'rounded-md bg-sky-500/20 px-3 py-1.5 text-sm font-semibold text-sky-200'
                  : 'rounded-md px-3 py-1.5 text-sm font-medium text-zinc-400 hover:text-zinc-200'
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {notice && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-amber-300/70 hover:text-amber-200"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {view === 'audit' ? (
          <AuditHistoryView />
        ) : loadState === 'loading' ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
            Loading board…
          </div>
        ) : error ? (
          <div className="p-4 bg-red-950/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
            ⚠️ Error loading board: {error}
          </div>
        ) : (
          <>
            <BoardToolbar
              query={query}
              onQueryChange={setQuery}
              filter={filter}
              onFilterChange={setFilter}
              resultCount={filteredOrders.length}
              totalCount={orders.length}
              onClear={clearFilters}
            />
            <KanbanBoard
              orders={filteredOrders}
              onMove={handleMove}
              onRequestUnlock={setUnlockTarget}
              onSelectOrder={setSelectedOrder}
              onEditOrder={setEditTarget}
              staffRoster={staffRoster}
            />
          </>
        )}
      </div>

      <RODetailDrawer
        key={selectedOrder?.id ?? 'none'}
        order={selectedOrder}
        parts={
          selectedOrder?.claim_number
            ? MOCK_PARTS_BY_CLAIM[selectedOrder.claim_number] ?? []
            : []
        }
        onClose={() => setSelectedOrder(null)}
        onRequestUnlock={(order) => {
          setSelectedOrder(null);
          setUnlockTarget(order);
        }}
      />

      <UnlockGateModal
        order={unlockTarget}
        busy={unlockBusy}
        onCancel={() => !unlockBusy && setUnlockTarget(null)}
        onConfirm={handleConfirmUnlock}
      />

      {editTarget && (
        <EditRepairOrderModal
          key={editTarget.id}
          order={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={handleEditSave}
        />
      )}

      {newIntakeOpen && (
        <NewIntakeModal
          onClose={() => setNewIntakeOpen(false)}
          onCreate={handleCreateIntake}
        />
      )}
    </div>
  );
}
