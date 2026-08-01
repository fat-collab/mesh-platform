import 'server-only';

/**
 * MESH — server-only Supabase helpers (Server Components, Server Actions,
 * and route handlers).
 *
 * Deliberately kept OUT of `supabase.ts`: that module is imported by ~27
 * client components, and neither `next/headers` nor the service-role key may
 * ever reach a module bundled into a Client Component. The `import
 * 'server-only'` above turns that into a build-time error instead of a
 * convention — bundling this file into client code now fails the build.
 */
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { supabaseUrl, supabasePublishableKey } from './supabase';

/**
 * Cookie-bound Supabase client for Server Components. Reads the session
 * cookie the browser client wrote; `setAll` is a no-op because Server
 * Components cannot set response cookies — middleware.ts refreshes the
 * session cookie on every request instead, so what's read here is fresh.
 */
export async function getSupabaseServerComponentClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabasePublishableKey, {
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

/**
 * Service-role (admin) client — bypasses RLS. Throws if the secret key is
 * missing rather than degrading to the publishable key: a silent privilege
 * downgrade here would fail closed in a confusing way (RLS-denied writes),
 * while a silent privilege escalation elsewhere is the opposite and worse
 * failure mode — neither should ever happen quietly.
 */
export function createSupabaseServerClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      'SUPABASE_SECRET_KEY is not set — refusing to start with a missing Supabase credential.',
    );
  }
  return createSupabaseClient(supabaseUrl, secretKey, {
    auth: { persistSession: false },
  });
}
