'use client';

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[DASHBOARD_RENDER_ERROR]', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-white">
      <div className="max-w-md w-full bg-neutral-900 border border-red-500/30 rounded-xl p-6 shadow-2xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          <h2 className="text-lg font-semibold text-red-400">System Exception Detected</h2>
        </div>
        <p className="text-sm text-neutral-400 mb-6 font-mono bg-neutral-950 p-3 rounded border border-neutral-800">
          {error.message || 'An unexpected failure occurred in the operational data layer.'}
        </p>
        <div className="flex space-x-3">
          <button
            onClick={() => reset()}
            className="flex-1 bg-red-600 hover:bg-red-500 text-white font-medium py-2 px-4 rounded-lg text-sm transition"
          >
            Re-Sync Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
