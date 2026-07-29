import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

// Fallback values keep the app runnable without a populated .env.local (this
// is the linked demo project's own public URL/anon key, safe to ship as a
// default). Real env vars still take precedence when set.
export const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jgvjbugncpmcxveuhjgj.supabase.co';

export const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpndmpidWduY3BtY3h2ZXVoamdqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDg2Nzc1OCwiZXhwIjoyMTAwNDQzNzU4fQ.mHwZW9ykXwIbCjZdHyKpWVyNiDwIYv2e2-GFjGmMfTA';

// Next.js dev Fast Refresh can re-evaluate this module on unrelated edits,
// which used to spawn a fresh GoTrueClient each time ("Multiple GoTrueClient
// instances detected in the same browser context"). Cache both clients on
// globalThis so a hot reload reuses the same instances instead of duplicating
// them; in production this is a no-op module singleton (no HMR re-execution).
const globalForSupabase = globalThis as unknown as {
  __meshSupabase?: ReturnType<typeof createSupabaseClient>;
  __meshSupabaseBrowser?: ReturnType<typeof createBrowserClient>;
};

export const supabase =
  globalForSupabase.__meshSupabase ?? createSupabaseClient(supabaseUrl, supabaseAnonKey);

if (process.env.NODE_ENV !== 'production') {
  globalForSupabase.__meshSupabase = supabase;
}

// Browser client persists the session in cookies (via @supabase/ssr) rather
// than localStorage, so server-side code (the dashboard layout guard,
// proxy.ts) can read the same session a client component established.
// API-compatible with the plain supabase-js client — same
// .auth/.from()/.channel() surface — so every existing
// getSupabaseBrowserClient() caller works unchanged.
let browserClient: ReturnType<typeof createBrowserClient> | undefined =
  globalForSupabase.__meshSupabaseBrowser;

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey);
    globalForSupabase.__meshSupabaseBrowser = browserClient;
  }
  return browserClient;
}

/**
 * The concrete Supabase client type used across the DAL. Deliberately derived
 * from getSupabaseBrowserClient (not the bare `supabase` singleton): passing
 * an options object to createClient — as createSupabaseUserClient,
 * createSupabaseServerClient, and @supabase/ssr's createBrowserClient all do —
 * resolves a different (newer) SupabaseClient generic shape than a bare
 * no-options createClient(url, key) call. Every real call site uses one of
 * the "with options" clients, so this is the shape that actually matches them.
 */
export type MeshSupabaseClient = ReturnType<typeof getSupabaseBrowserClient>;

/** Service-role (admin) client — bypasses RLS. Server-only. */
export function createSupabaseServerClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
  return createSupabaseClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

/** User-scoped client — runs queries under the caller's JWT (RLS enforced). */
export function createSupabaseUserClient(accessToken: string) {
  return createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  });
}
