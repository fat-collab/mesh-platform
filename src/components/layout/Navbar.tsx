'use client';

/**
 * Navbar — sticky dashboard header: section links, tenant/role badge, logout.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getCurrentProfile, type CurrentProfile } from '@/lib/auth';

const NAV_LINKS = [
  { href: '/dashboard/ops', label: 'Ops Board' },
  { href: '/dashboard/sales', label: 'Sales' },
  { href: '/dashboard/fleet', label: 'Fleet' },
  { href: '/dashboard/supplements', label: 'Supplements' },
  { href: '/dashboard/rebuttals', label: 'Rebuttals' },
  { href: '/dashboard/payouts', label: 'Payouts' },
  { href: '/dashboard/settings', label: 'Shop Profile' },
] as const;

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<CurrentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const p = await getCurrentProfile(supabase);
        if (!cancelled) setProfile(p);
      } catch {
        if (!cancelled) setProfile(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Role-gated links: Technician Hub for floor + oversight (TECH/MANAGER/
  // EXECUTIVE), Inventory for management (MANAGER/EXECUTIVE), Executive
  // Analytics for EXECUTIVE only.
  const links: { href: string; label: string }[] = [...NAV_LINKS];
  if (
    profile?.role === 'TECH' ||
    profile?.role === 'MANAGER' ||
    profile?.role === 'EXECUTIVE'
  ) {
    links.push({ href: '/dashboard/technicians', label: 'Technician Hub' });
  }
  if (profile?.role === 'MANAGER' || profile?.role === 'EXECUTIVE') {
    links.push({ href: '/dashboard/inventory', label: 'Inventory & POs' });
  }
  if (profile?.role === 'EXECUTIVE') {
    links.push({ href: '/dashboard/analytics', label: 'Executive Analytics' });
  }

  async function handleLogout() {
    setSigningOut(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      /* ignore — navigate away regardless */
    }
    router.replace('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-6">
        <Link href="/dashboard/ops" className="text-sm font-bold tracking-tight text-zinc-100">
          MESH
        </Link>

        <nav className="flex items-center gap-1">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {!loading && profile && (
            <div className="hidden items-center gap-2 sm:flex">
              {profile.organizationName && (
                <span
                  className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-300"
                  title="Current tenant"
                >
                  {profile.organizationName}
                </span>
              )}
              <span className="text-xs text-zinc-500">
                {profile.email}
                {profile.role && (
                  <span className="ml-1 text-zinc-600">· {profile.role}</span>
                )}
              </span>
            </div>
          )}

          {!loading && profile ? (
            <button
              type="button"
              onClick={handleLogout}
              disabled={signingOut}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-60"
            >
              {signingOut ? 'Signing out…' : 'Log out'}
            </button>
          ) : (
            !loading && (
              <Link
                href="/login"
                className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
              >
                Sign in
              </Link>
            )
          )}
        </div>
      </div>
    </header>
  );
}
