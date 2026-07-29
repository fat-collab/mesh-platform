import React, { useState } from 'react';
import { ShieldAlert, CheckCircle, Lock, AlertTriangle } from 'lucide-react';

interface CloseoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  repairOrderId: string;
  financialStatus: {
    deductibleCollected: boolean;
    insuranceCleared: boolean;
    unreconciledPartsCount: number;
    pendingSupplementsCount: number;
  };
  onExecuteCloseout: () => Promise<void>;
}

export const CloseoutModal: React.FC<CloseoutModalProps> = ({
  isOpen,
  onClose,
  repairOrderId,
  financialStatus,
  onExecuteCloseout,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isBlocked =
    !financialStatus.deductibleCollected ||
    !financialStatus.insuranceCleared ||
    financialStatus.unreconciledPartsCount > 0 ||
    financialStatus.pendingSupplementsCount > 0;

  const handleCloseout = async () => {
    if (isBlocked) return;
    try {
      setLoading(true);
      setError(null);
      await onExecuteCloseout();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to close repair order.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-6 w-6 text-amber-500" />
            <h3 className="text-lg font-bold tracking-wide">Financial Clearance Gate</h3>
          </div>
          <span className="rounded bg-zinc-800 px-2.5 py-1 text-xs font-mono text-zinc-400">
            RO #{repairOrderId}
          </span>
        </div>

        <div className="my-6 space-y-4">
          <p className="text-sm text-zinc-400">
            All financial checks, vendor invoices, and supplements must be reconciled before transitioning this job to <span className="font-semibold text-zinc-200">closed_paid</span>.
          </p>

          <div className="space-y-3 rounded-lg bg-zinc-950 p-4 border border-zinc-800/80">
            <ChecklistItem
              label="Customer Deductible Collected"
              passed={financialStatus.deductibleCollected}
            />
            <ChecklistItem
              label="Primary Insurance Payout Cleared"
              passed={financialStatus.insuranceCleared}
            />
            <ChecklistItem
              label="Vendor Invoices Reconciled (0 Unmatched)"
              passed={financialStatus.unreconciledPartsCount === 0}
              detail={financialStatus.unreconciledPartsCount > 0 ? `${financialStatus.unreconciledPartsCount} unmatched` : undefined}
            />
            <ChecklistItem
              label="Supplements Approved & Settled (0 Pending)"
              passed={financialStatus.pendingSupplementsCount === 0}
              detail={financialStatus.pendingSupplementsCount > 0 ? `${financialStatus.pendingSupplementsCount} pending` : undefined}
            />
          </div>

          {isBlocked && (
            <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-400">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <p className="text-xs font-medium">
                Closeout locked. Clear all financial flags before unlocking ledger archival.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-zinc-800 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCloseout}
            disabled={isBlocked || loading}
            className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition-all ${
              isBlocked || loading
                ? 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-900/30'
            }`}
          >
            <Lock className="h-4 w-4" />
            {loading ? 'Processing...' : 'Authorize & Close RO'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ChecklistItem: React.FC<{ label: string; passed: boolean; detail?: string }> = ({ label, passed, detail }) => (
  <div className="flex items-center justify-between text-sm">
    <div className="flex items-center gap-2.5">
      {passed ? (
        <CheckCircle className="h-4 w-4 text-emerald-500" />
      ) : (
        <div className="h-4 w-4 rounded-full border-2 border-zinc-700" />
      )}
      <span className={passed ? 'text-zinc-200' : 'text-zinc-400 font-medium'}>{label}</span>
    </div>
    {detail && <span className="text-xs font-mono text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">{detail}</span>}
  </div>
);
