'use client';

/**
 * BoardToolbar — search + quick-filter toolbar for the Ops Cockpit board.
 *
 * Purely presentational: it emits query/filter changes and shows the filtered
 * result count. The actual predicate logic lives in the board container so the
 * same filtered array drives both the columns and their stage counters.
 */
import { clsx } from 'clsx';

/** Quick-filter chip identifiers. */
export type BoardFilter = 'all' | 'holds' | 'parts' | 'high_risk' | 'aluminum';

export const BOARD_FILTERS: ReadonlyArray<{ id: BoardFilter; label: string }> = [
  { id: 'all', label: 'All Orders' },
  { id: 'holds', label: 'Active Holds Only' },
  { id: 'parts', label: 'Parts Delay / Ordering' },
  { id: 'high_risk', label: 'High Risk / Total Loss' },
  { id: 'aluminum', label: 'Aluminum (AL)' },
];

export interface BoardToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  filter: BoardFilter;
  onFilterChange: (filter: BoardFilter) => void;
  /** Cards passing the current search + filter. */
  resultCount: number;
  /** Total cards on the board, ignoring search + filter. */
  totalCount: number;
  onClear: () => void;
}

export function BoardToolbar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  resultCount,
  totalCount,
  onClear,
}: BoardToolbarProps) {
  const isFiltering = query.trim().length > 0 || filter !== 'all';

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 lg:flex-row lg:items-center lg:justify-between">
      {/* Search bar */}
      <div className="relative w-full lg:max-w-sm">
        <span
          className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-zinc-500"
          aria-hidden
        >
          🔍
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search VIN (or last 8), claim #, customer, or vehicle…"
          aria-label="Search orders by VIN, claim number, customer, or vehicle"
          className="w-full rounded-md border border-zinc-700 bg-zinc-950/70 py-1.5 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
        />
      </div>

      {/* Quick-filter chips + clear */}
      <div className="flex flex-wrap items-center gap-1.5">
        {BOARD_FILTERS.map(({ id, label }) => {
          const active = filter === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onFilterChange(id)}
              aria-pressed={active}
              className={clsx(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                  : 'border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800',
              )}
            >
              {label}
            </button>
          );
        })}

        {isFiltering && (
          <>
            <span className="ml-1 text-xs tabular-nums text-zinc-500">
              {resultCount} of {totalCount}
            </span>
            <button
              type="button"
              onClick={onClear}
              className="rounded-full border border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
            >
              Clear Filters
            </button>
          </>
        )}
      </div>
    </div>
  );
}
