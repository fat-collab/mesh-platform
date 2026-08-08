'use client';

/**
 * CarrierPicker — offers the known carriers from carrier-intel.ts plus an
 * explicit "Other" free-text fallback, so a typo can no longer fall silently
 * through to DEFAULT_INTEL's generic checklist in place of that carrier's
 * real requirements.
 *
 * Preserves whatever's already stored: an existing free-text value that
 * doesn't exactly match a known carrier (legacy data, or a typo) renders as
 * "Other" with that value left in the text field as-is — never cleared or
 * silently remapped to the nearest match.
 */
import { useState } from 'react';
import { KNOWN_CARRIERS } from '@/lib/carrier-intel';

const OTHER = '__OTHER__';

interface CarrierPickerProps {
  value: string;
  onChange: (value: string) => void;
  className: string;
}

export function CarrierPicker({ value, onChange, className }: CarrierPickerProps) {
  const isKnown = KNOWN_CARRIERS.includes(value);
  // An empty `value` is ambiguous — "nothing chosen yet" and "Other, nothing
  // typed yet" both store ''. That can't be told apart from `value` alone,
  // so whether Other is the active selection has to be its own state,
  // seeded once from whatever's already stored (a non-empty, unmatched
  // value only ever means Other — see the module doc comment). Assumes one
  // fresh mount per lead/session, true for all three current call sites
  // (each opens in a modal or drawer that mounts fresh, never reused across
  // a different lead without unmounting first).
  const [otherSelected, setOtherSelected] = useState(value !== '' && !isKnown);
  const selectValue = isKnown ? value : otherSelected ? OTHER : '';

  return (
    <div className="space-y-1.5">
      <select
        value={selectValue}
        onChange={(e) => {
          const next = e.target.value;
          if (next === OTHER) {
            setOtherSelected(true);
            // Switching a known carrier to Other clears the field so the rep
            // types fresh text; anything already unmatched (typo/legacy
            // value) or already blank is left exactly as-is.
            if (isKnown) onChange('');
            return;
          }
          setOtherSelected(false);
          onChange(next);
        }}
        aria-label="Insurance carrier"
        className={className}
      >
        <option value="" className="bg-zinc-900">
          Insurance carrier
        </option>
        {KNOWN_CARRIERS.map((c) => (
          <option key={c} value={c} className="bg-zinc-900">
            {c}
          </option>
        ))}
        <option value={OTHER} className="bg-zinc-900">
          Other…
        </option>
      </select>
      {selectValue === OTHER && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Carrier name"
          aria-label="Carrier name"
          className={className}
        />
      )}
    </div>
  );
}
