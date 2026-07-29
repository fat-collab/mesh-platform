/**
 * MESH — database operation guard.
 *
 * Wraps a Supabase DAL call with consistent logging + environment-aware error
 * handling: in production a DB failure throws (never silently masked by mock
 * data); in development it logs and returns the provided fallback so local work
 * stays unblocked.
 */
import type { PostgrestError } from '@supabase/supabase-js';

export type DALResult<T> = {
  data: T | null;
  error: string | null;
};

export async function executeDBOperation<T>(
  operationName: string,
  operation: () => Promise<{ data: T | null; error: PostgrestError | null }>,
  fallbackData: T,
): Promise<DALResult<T>> {
  try {
    const { data, error } = await operation();

    if (error) {
      console.error(`[DB_ERROR] Failed during ${operationName}:`, error.message);

      // In production, never silently swallow DB failures with mock data.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Database operation failed: ${operationName} - ${error.message}`);
      }

      // Development fallback.
      return { data: fallbackData, error: error.message };
    }

    return { data, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error occurred';
    console.error(`[CRITICAL_DB_EXCEPTION] ${operationName}:`, message);

    if (process.env.NODE_ENV === 'production') {
      throw err;
    }

    // Fallback for local dev continuity.
    return { data: fallbackData, error: message };
  }
}
