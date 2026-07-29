'use client';

import { useEffect } from 'react';

export default function OpsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[OPS_DASHBOARD_CRITICAL_FAILURE]', error);
  }, [error]);

  return (
    <div className="p-8 max-w-xl mx-auto mt-12 bg-red-950/20 border border-red-500/30 rounded-lg text-white">
      <h2 className="text-lg font-bold text-red-400 mb-2">Operational Data Feed Interrupted</h2>
      <p className="text-sm text-neutral-300 mb-4">
        {error.message || 'An unexpected error occurred while communicating with the database.'}
      </p>
      <button
        onClick={() => reset()}
        className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded transition"
      >
        Retry Data Sync
      </button>
    </div>
  );
}
