'use client';

/**
 * /dashboard/team — EXECUTIVE-only team roster + invite management.
 *
 * Minimum viable version: current members (name/email/role), pending
 * invites (email/role/sent/expiry) with revoke, and a send-invite form
 * covering all six roles. No org-settings page exists yet to fold this
 * into (see the earlier report — /dashboard/settings writes to a tmp-file
 * mock, not `organizations`) — this page is deliberately self-contained so
 * a real settings section can link to or absorb it later without having to
 * duplicate the team-roster/invite logic living here in invites-db.ts.
 *
 * EXECUTIVE-gated client-side: dashboard/layout.tsx's server-side guard
 * only checks "has an organization", not role, so a non-EXECUTIVE who
 * navigates here directly still needs to be caught here and redirected —
 * mirrors dashboard/setup's own checking/ready gate pattern.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getCurrentProfile, type CurrentProfile } from '@/lib/auth';
import {
  getTeamMembers,
  getPendingInvites,
  sendInvite,
  revokeInvite,
  INVITE_ROLES,
  type InviteRole,
  type TeamMember,
  type PendingInvite,
} from '@/lib/invites-db';

type Gate = 'checking' | 'denied' | 'ready';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

export default function TeamPage() {
  const router = useRouter();
  const [gate, setGate] = useState<Gate>('checking');
  const [profile, setProfile] = useState<CurrentProfile | null>(null);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('TECH');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const refresh = async (organizationId: string) => {
    try {
      const [teamRows, inviteRows] = await Promise.all([
        getTeamMembers(organizationId),
        getPendingInvites(organizationId),
      ]);
      setMembers(teamRows);
      setInvites(inviteRows);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load team data.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = getSupabaseBrowserClient();
      const p = await getCurrentProfile(supabase);
      if (cancelled) return;

      if (!p || !p.organizationId) {
        router.replace('/login');
        return;
      }
      if (p.role !== 'EXECUTIVE') {
        router.replace('/dashboard/ops');
        return;
      }

      setProfile(p);
      await refresh(p.organizationId);
      if (!cancelled) setGate('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault();
    setSendError(null);
    setSendSuccess(null);

    const email = inviteEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setSendError('Enter a valid email address.');
      return;
    }

    setSending(true);
    try {
      const result = await sendInvite(email, inviteRole);
      if (!result.success) {
        setSendError(result.error || 'Failed to send invite.');
        return;
      }
      setSendSuccess(`Invite sent to ${email}.`);
      setInviteEmail('');
      setInviteRole('TECH');
      if (profile?.organizationId) await refresh(profile.organizationId);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send invite.');
    } finally {
      setSending(false);
    }
  }

  async function handleRevoke(invite: PendingInvite) {
    if (!profile?.organizationId) return;
    setRevokingId(invite.id);
    try {
      await revokeInvite(invite.id, profile.organizationId);
      await refresh(profile.organizationId);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to revoke invite.');
    } finally {
      setRevokingId(null);
    }
  }

  if (gate !== 'ready') {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
        {gate === 'checking' ? 'Loading…' : 'Redirecting…'}
      </div>
    );
  }

  const input =
    'rounded-md border border-zinc-700 bg-zinc-950/70 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none';

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-6 py-6">
        <header className="mb-5">
          <h1 className="text-xl font-bold tracking-tight">Team</h1>
          <p className="text-sm text-zinc-400">
            Manage who has access to {profile?.organizationName ?? 'your shop'} and what they can do.
          </p>
        </header>

        {loadError && (
          <div className="mb-4 rounded-md border border-red-500/30 bg-red-950/20 px-3 py-2 text-sm text-red-400">
            {loadError}
          </div>
        )}

        {/* Send invite */}
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-200">Invite a team member</h2>
          <form onSubmit={handleSendInvite} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[14rem]">
              <label htmlFor="inviteEmail" className="mb-1 block text-xs font-medium text-zinc-500">
                Email
              </label>
              <input
                id="inviteEmail"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="rep@shop.com"
                className={`${input} w-full`}
              />
            </div>
            <div>
              <label htmlFor="inviteRole" className="mb-1 block text-xs font-medium text-zinc-500">
                Role
              </label>
              <select
                id="inviteRole"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as InviteRole)}
                className={input}
              >
                {INVITE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={sending}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
            >
              {sending ? 'Sending…' : 'Send invite'}
            </button>
          </form>
          {sendError && <p className="mt-2 text-xs text-red-400">{sendError}</p>}
          {sendSuccess && <p className="mt-2 text-xs text-emerald-400">{sendSuccess}</p>}
        </section>

        {/* Pending invites */}
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-zinc-200">
            Pending invites {invites.length > 0 && <span className="text-zinc-500">({invites.length})</span>}
          </h2>
          {invites.length === 0 ? (
            <p className="text-sm text-zinc-500">No pending invites.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-800 bg-zinc-900/60 text-[11px] uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 font-mono">Email</th>
                    <th className="px-3 py-2 font-mono">Role</th>
                    <th className="px-3 py-2 font-mono">Sent</th>
                    <th className="px-3 py-2 font-mono">Expires</th>
                    <th className="px-3 py-2 font-mono">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((invite) => (
                    <tr key={invite.id} className="border-b border-zinc-800/60">
                      <td className="px-3 py-2 text-zinc-200">{invite.email}</td>
                      <td className="px-3 py-2 text-zinc-400">{invite.role}</td>
                      <td className="px-3 py-2 text-zinc-400">{formatDate(invite.createdAt)}</td>
                      <td className="px-3 py-2 text-zinc-400">{formatDate(invite.expiresAt)}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => void handleRevoke(invite)}
                          disabled={revokingId === invite.id}
                          className="rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                        >
                          {revokingId === invite.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Current team */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-200">
            Team members {members.length > 0 && <span className="text-zinc-500">({members.length})</span>}
          </h2>
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/60 text-[11px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-mono">Name</th>
                  <th className="px-3 py-2 font-mono">Email</th>
                  <th className="px-3 py-2 font-mono">Role</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className="border-b border-zinc-800/60">
                    <td className="px-3 py-2 text-zinc-200">{member.fullName || '—'}</td>
                    <td className="px-3 py-2 text-zinc-400">{member.email || '—'}</td>
                    <td className="px-3 py-2 text-zinc-400">{member.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
