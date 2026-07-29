import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://jgvjbugncpmcxveuhjgj.supabase.co';

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpndmpidWduY3BtY3h2ZXVoamdqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDg2Nzc1OCwiZXhwIjoyMTAwNDQzNzU4fQ.mHwZW9ykXwIbCjZdHyKpWVyNiDwIYv2e2-GFjGmMfTA';

export const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey);

export function createClient() {
  return createSupabaseClient(supabaseUrl, supabaseAnonKey);
}

export function getSupabaseBrowserClient() {
  return supabase;
}

export function getSupabaseServerClient() {
  return supabase;
}

export function getSupabaseClient() {
  return supabase;
}

/** The concrete Supabase client type used across the DAL. */
export type MeshSupabaseClient = typeof supabase;

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

export default supabase;
