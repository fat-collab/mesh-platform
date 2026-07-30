/**
 * MESH — session refresh + pathname forwarding middleware.
 *
 * Two jobs:
 *  1. Refresh the Supabase auth cookie on every request. Server Components can
 *     only READ cookies (never write them back), so without this, an expiring
 *     session would never get its refreshed token persisted to the browser.
 *  2. Forward the current pathname via an `x-pathname` header — Next.js App
 *     Router layouts aren't given the pathname as a prop, so
 *     `app/dashboard/layout.tsx` reads it from here to know whether it's
 *     already rendering `/dashboard/setup` (and should skip its redirect).
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseUrl, supabaseAnonKey } from '@/lib/supabase';

export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Touches the Auth server to refresh the token if needed; the setAll above
  // persists the refreshed cookie onto the response.
  try {
    await supabase.auth.getUser();
  } catch {
    // Gracefully handle invalid or missing refresh tokens without crashing logs
    console.warn('Invalid session or refresh token, continuing unauthenticated.');
  }

  return response;
}

export const config = {
  // Runs on everything except static assets / Next internals, to keep the
  // session cookie fresh app-wide while staying cheap.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
