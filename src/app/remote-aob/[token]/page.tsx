'use client';

/**
 * /remote-aob/[token] — Remote AOB Execution Gate.
 *
 * Public, unauthenticated by design: the off-site proxy policyholder who
 * opens this link has no MESH account. The token itself is the security
 * boundary (see the remote_aob_links migration).
 *
 * Two server calls, both strictly token-keyed (never accept a lead id from
 * this page):
 *  - GET  /api/v1/remote-aob/[token]/summary — vehicle/claim header fields
 *    for AobAgreementText, resolved server-side from the token via
 *    remote_aob_links, since this page's own anon client can't read the now
 *    org-scoped intake_leads table directly.
 *  - POST /api/v1/remote-aob/[token]/sign — records the signature and
 *    advances the lead's status as one server-side request instead of two
 *    independent client calls (signRemoteAobLink + updateLeadStatus), so a
 *    failure between them is a single retryable error rather than a state
 *    that can silently half-complete.
 *
 * NOTE: the auto-convert-to-RO business rule that fires when the on-site
 * wizard signs a lead does NOT fire from this path — see the /sign route's
 * own comment for why. A remotely-signed lead reaches AOB_SIGNED correctly;
 * it does not auto-convert into a repair order the way on-site signing does.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getRemoteAobLink, type RemoteAobLinkRecord } from '@/lib/remote-aob-db';
import { AobAgreementText, type AobAgreementTextProps } from '@/components/sales/AobAgreementText';
import { SignaturePad } from '@/components/sales/SignaturePad';

export default function RemoteAobSigningPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [link, setLink] = useState<RemoteAobLinkRecord | null>(null);
  const [leadSummary, setLeadSummary] = useState<AobAgreementTextProps>({});
  const [loading, setLoading] = useState(true);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const record = await getRemoteAobLink(token);
      if (cancelled) return;
      setLink(record);
      if (record) {
        try {
          const res = await fetch(`/api/v1/remote-aob/${encodeURIComponent(token)}/summary`);
          if (res.ok && !cancelled) {
            setLeadSummary((await res.json()) as AobAgreementTextProps);
          }
        } catch {
          /* best-effort — AobAgreementText renders fine with no header line */
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async () => {
    if (!signatureDataUrl || !agreed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/remote-aob/${encodeURIComponent(token)}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureDataUrl }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to submit signature.');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit signature.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  if (!link) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-center">
        <div>
          <h1 className="text-lg font-bold text-zinc-100">Link not found</h1>
          <p className="mt-2 text-sm text-zinc-500">
            This signing link is invalid or has expired. Please contact the shop for a new one.
          </p>
        </div>
      </div>
    );
  }

  if (link.status === 'SIGNED' || done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-center">
        <div>
          <h1 className="text-lg font-bold text-emerald-300">✓ Authorization signed</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Thank you — the shop has been notified and will proceed with the repair.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <div className="mx-auto max-w-md space-y-4">
        <div>
          <h1 className="text-lg font-bold">Repair Authorization</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Hi {link.proxy.fullName.split(' ')[0] || link.proxy.fullName}, please review and sign
            the authorization below on behalf of the policyholder
            {link.proxy.relationship ? ` (${link.proxy.relationship})` : ''}.
          </p>
        </div>

        <AobAgreementText {...leadSummary} />

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <label className="flex items-start gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5"
          />
          I have read and accept all terms (a)–(e) above and authorize the work.
        </label>

        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
            Signature
          </p>
          <SignaturePad onChange={setSignatureDataUrl} />
        </div>

        <button
          type="button"
          disabled={!signatureDataUrl || !agreed || submitting}
          onClick={() => void submit()}
          className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Sign & Authorize'}
        </button>
      </div>
    </div>
  );
}
