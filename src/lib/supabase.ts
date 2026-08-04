import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set — refusing to start with a missing Supabase credential.`);
  }
  return value;
}

export const supabaseUrl = requireEnv(
  'NEXT_PUBLIC_SUPABASE_URL',
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

export const supabasePublishableKey = requireEnv(
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

// Next.js dev Fast Refresh can re-evaluate this module on unrelated edits,
// which used to spawn a fresh GoTrueClient each time ("Multiple GoTrueClient
// instances detected in the same browser context"). Cache the client on
// globalThis so a hot reload reuses the same instance instead of duplicating
// it; in production this is a no-op module singleton (no HMR re-execution).
//
// There used to be a second, eagerly-constructed bare `supabase` export
// here too — every `createClient()` call constructs a live GoTrueClient as
// a side effect of construction, whether or not `.auth` is ever called on
// the result, so simply importing this module for `supabaseUrl` created a
// second GoTrueClient on the same storage key as this one below, which is
// what was actually triggering the "Multiple GoTrueClient instances"
// warning — not HMR. It was unused (confirmed: nothing in the codebase
// imported it), so it's gone. One client per browser context now.
const globalForSupabase = globalThis as unknown as {
  __meshSupabaseBrowser?: ReturnType<typeof createBrowserClient>;
};

// Browser client persists the session in cookies (via @supabase/ssr) rather
// than localStorage, so server-side code (the dashboard layout guard,
// proxy.ts) can read the same session a client component established.
let browserClient: ReturnType<typeof createBrowserClient> | undefined =
  globalForSupabase.__meshSupabaseBrowser;

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(supabaseUrl, supabasePublishableKey);
    globalForSupabase.__meshSupabaseBrowser = browserClient;
  }
  return browserClient;
}

/**
 * The concrete Supabase client type used across the DAL. Deliberately derived
 * from getSupabaseBrowserClient: passing an options object to createClient —
 * as createSupabaseUserClient, createSupabaseServerClient
 * (src/lib/supabase-server.ts), and @supabase/ssr's createBrowserClient all
 * do — resolves a different (newer) SupabaseClient generic shape than a bare
 * no-options createClient(url, key) call. Every real call site uses one of
 * the "with options" clients, so this is the shape that actually matches
 * them.
 */
export type MeshSupabaseClient = ReturnType<typeof getSupabaseBrowserClient>;

/** User-scoped client — runs queries under the caller's JWT (RLS enforced). */
export function createSupabaseUserClient(accessToken: string) {
  return createSupabaseClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  });
}
