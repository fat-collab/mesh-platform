'use client';

/**
 * LeadOwnerChip — shows the sales rep accountable for a lead and lets a manager
 * reassign it inline. Persists via sales-db (DB when available, else local).
 */
import { useState } from 'react';
import { assignLeadStaff } from '@/lib/sales-db';

interface LeadOwnerChipProps {
  leadId: string;
  staffName?: string;
  /** Called after a successful (re)assignment so the board can refetch. */
  onAssigned?: () => void;
}

export function LeadOwnerChip({ leadId, staffName, onAssigned }: LeadOwnerChipProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(staffName ?? '');
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const next = value.trim();
    if (next === (staffName ?? '').trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await assignLeadStaff(leadId, next || null);
      onAssigned?.();
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit();
          if (e.key === 'Escape') {
            setValue(staffName ?? '');
            setEditing(false);
          }
        }}
        placeholder="Assign rep…"
        aria-label="Assign rep"
        className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950/70 px-1.5 py-0.5 text-[11px] text-zinc-100 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setValue(staffName ?? '');
        setEditing(true);
      }}
      title="Reassign lead owner"
      className="mt-1 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200"
    >
      <span aria-hidden>👤</span>
      {staffName ? (
        <span className="truncate">{staffName}</span>
      ) : (
        <span className="italic text-amber-400/80">Unassigned</span>
      )}
    </button>
  );
}
