/**
 * CarrierTierBadge — compact carrier automation-tier badge with FNOL guidance.
 *
 * Renders "Tier N · <label>" (tone-coded) for a carrier name; the friction
 * point is the tooltip. Pass `showHint` to also render the field FNOL strategy.
 */
import { clsx } from 'clsx';
import { CARRIER_TIER_TONE, classifyCarrier } from '@/lib/carrier-tiers';

export interface CarrierTierBadgeProps {
  carrier?: string | null;
  showHint?: boolean;
  className?: string;
}

export function CarrierTierBadge({ carrier, showHint = false, className }: CarrierTierBadgeProps) {
  const name = (carrier ?? '').trim();
  if (!name) return null;

  const info = classifyCarrier(name);

  return (
    <div className={className}>
      <span
        title={info.friction}
        className={clsx(
          'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold',
          CARRIER_TIER_TONE[info.tier],
        )}
      >
        Tier {info.tier} · {info.label}
      </span>
      {showHint && (
        <p className="mt-1 text-[11px] text-zinc-400">
          <span className="text-zinc-500">FNOL:</span> {info.fnolStrategy}
        </p>
      )}
    </div>
  );
}
