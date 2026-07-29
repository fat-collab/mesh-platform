'use client';

/**
 * RODrawerStaffingSection — staffing panel for the RO Detail Drawer.
 *
 * Lists the repair order's staff assignments grouped by role and lets a manager
 * add or remove them. Backed by assignments-db (DB-first with a session-local
 * fallback), so it works whether or not the order_assignments table is present.
 */
import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { getAssignments, assignStaff, removeAssignment } from '@/lib/assignments-db';
import {
  STAFF_ROLE_LABEL,
  STAFF_ROLE_ORDER,
  type OrderAssignment,
  type StaffRole,
} from '@/components/ops/types';

const ROLE_TONE: Record<StaffRole, string> = {
  SALES: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  ESTIMATOR: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
  BODY_TECH: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  PAINTER: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  FOREMAN: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

export interface RODrawerStaffingSectionProps {
  repairOrderId: string;
}

export function RODrawerStaffingSection({ repairOrderId }: RODrawerStaffingSectionProps) {
  const [open, setOpen] = useState(true);
  const [assignments, setAssignments] = useState<OrderAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('ESTIMATOR');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const rows = await getAssignments(repairOrderId);
    setAssignments(rows);
  }, [repairOrderId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const rows = await getAssignments(repairOrderId);
      if (cancelled) return;
      setAssignments(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [repairOrderId]);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await assignStaff(repairOrderId, { staffName: name, role: newRole });
      setNewName('');
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    await removeAssignment(id);
    await refresh();
  };

  // Order assignments by the canonical role order, then arrival within a role.
  const ordered = [...assignments].sort(
    (a, b) => STAFF_ROLE_ORDER.indexOf(a.role) - STAFF_ROLE_ORDER.indexOf(b.role),
  );

  const inputCls =
    'rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40';

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Staffing{assignments.length > 0 ? ` · ${assignments.length}` : ''}
        </h3>
        <span className="text-zinc-500">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          {loading ? (
            <p className="text-xs text-zinc-500">Loading staffing…</p>
          ) : ordered.length === 0 ? (
            <p className="text-xs text-zinc-500">No staff assigned yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {ordered.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={clsx(
                        'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold',
                        ROLE_TONE[a.role],
                      )}
                    >
                      {STAFF_ROLE_LABEL[a.role]}
                    </span>
                    <span className="truncate text-sm text-zinc-100">{a.staffName}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleRemove(a.id)}
                    aria-label={`Remove ${a.staffName}`}
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-300"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add assignment */}
          <div className="flex items-center gap-2 border-t border-zinc-800 pt-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAdd();
              }}
              placeholder="Staff name"
              aria-label="Staff name"
              className={clsx(inputCls, 'min-w-0 flex-1')}
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as StaffRole)}
              aria-label="Role"
              className={inputCls}
            >
              {STAFF_ROLE_ORDER.map((r) => (
                <option key={r} value={r} className="bg-zinc-900">
                  {STAFF_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={!newName.trim() || saving}
              className="shrink-0 rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
