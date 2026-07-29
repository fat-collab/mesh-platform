/**
 * MESH — server-only Supabase helpers (Server Components / layouts).
 *
 * Deliberately kept OUT of `supabase.ts`: that module is imported by ~27
 * client components, and `next/headers` cannot be imported into any module
 * reachable from a Client Component's bundle. This file is only ever imported
 * from Server Components (e.g. `app/dashboard/layout.tsx`).
 */
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseUrl, supabaseAnonKey } from './supabase';

/**
 * Cookie-bound Supabase client for Server Components. Reads the session
 * cookie the browser client wrote; `setAll` is a no-op because Server
 * Components cannot set response cookies — middleware.ts refreshes the
 * session cookie on every request instead, so what's read here is fresh.
 */
export async function getSupabaseServerComponentClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        /* no-op — Server Components can't write cookies */
      },
    },
  });
}
