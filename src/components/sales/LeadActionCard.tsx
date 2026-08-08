'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { reopenLead } from '@/lib/sales-db';
import { getSupabaseBrowserClient } from '@/lib/supabase';

interface LeadActionCardProps {
  leadId: string;
  leadStatus: string;
  hasClaim: boolean;
  isSigned: boolean;
  onStatusChange?: () => void;
}

export function LeadActionCard({
  leadId,
  leadStatus,
  hasClaim,
  isSigned,
  onStatusChange,
}: LeadActionCardProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isTerminated = leadStatus === 'LOST';
  const isConverted = leadStatus === 'CONVERTED';
  const isReadyToConvert = hasClaim && isSigned && !isTerminated && !isConverted;

  // Active-lead path: convert to a shop RO (redirects to the Ops board).
  const handleConvertToRO = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      // Forward the session token so the route can resolve the caller's org.
      const {
        data: { session },
      } = await getSupabaseBrowserClient().auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      const res = await fetch(`/api/v1/sales/leads/${leadId}/convert`, {
        method: 'POST',
        headers,
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to convert lead.');
      router.push('/dashboard/ops');
      router.refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to convert lead.');
    } finally {
      setIsLoading(false);
    }
  };

  // Terminated-lead path: reopen only (status -> CONTACTED, reason cleared).
  // Converting is a separate, later step through the same Convert button
  // above, once the lead is actually ready — no different from any other
  // lead's path onto the shop floor.
  const handleReopen = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await reopenLead(leadId);
      onStatusChange?.();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to reopen lead.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {errorMessage && (
        <div className="p-2 text-xs bg-red-950/50 border border-red-500/50 text-red-300 rounded">
          {errorMessage}
        </div>
      )}

      {isTerminated ? (
        <button
          type="button"
          onClick={handleReopen}
          disabled={isLoading}
          className="w-full py-2 px-4 rounded font-semibold text-sm bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:opacity-50"
        >
          {isLoading ? 'Reopening…' : 'Reopen'}
        </button>
      ) : isConverted ? (
        <button
          type="button"
          disabled
          className="w-full py-2 px-4 rounded font-semibold text-sm bg-zinc-800 text-zinc-500 cursor-not-allowed"
        >
          RO Active on Floor
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={handleConvertToRO}
            disabled={!isReadyToConvert || isLoading}
            className={`w-full py-2 px-4 rounded font-semibold text-sm transition-all ${
              isReadyToConvert
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20'
                : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}
          >
            {isLoading ? 'Converting to RO...' : 'Convert to Shop RO'}
          </button>
          {!isReadyToConvert && (
            <span className="text-[10px] text-amber-400 text-center">
              * Requires Claim # and signed AOB agreement to convert.
            </span>
          )}
        </>
      )}
    </div>
  );
}
