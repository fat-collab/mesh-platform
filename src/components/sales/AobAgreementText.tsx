export interface AobAgreementTextProps {
  /** Auto-populated from the captured lead/vault metadata — omit any field
   *  that hasn't been captured yet; the header line only names what's known. */
  customerName?: string;
  vehicleYear?: number | string;
  vehicleMake?: string;
  vehicleModel?: string;
  vinLast8?: string;
  claimNumber?: string;
  insuranceCarrier?: string;
  policyNumber?: string;
}

/** Renders the "This Agreement covers…" summary line from whatever lead/
 *  vault fields have been captured so far — the Agreement Auto-Population
 *  Engine's output for the legal-terms header. Returns null when nothing has
 *  been captured (e.g. the remote AOB page, which only knows the proxy). */
function AgreementHeader(props: AobAgreementTextProps) {
  const vehicle = [props.vehicleYear, props.vehicleMake, props.vehicleModel]
    .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
    .join(' ');
  const parts: string[] = [];
  if (props.customerName) parts.push(props.customerName);
  if (vehicle) parts.push(`for the ${vehicle}${props.vinLast8 ? ` (VIN …${props.vinLast8})` : ''}`);
  if (props.claimNumber) parts.push(`Claim #${props.claimNumber}`);
  if (props.insuranceCarrier) parts.push(`with ${props.insuranceCarrier}`);
  if (props.policyNumber) parts.push(`Policy #${props.policyNumber}`);
  if (parts.length === 0) return null;

  return (
    <p className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-[11px] text-zinc-300">
      This Agreement covers {parts.join(' — ')}.
    </p>
  );
}

/**
 * AobAgreementText — the Specialized PDR & Auto Hail Repair Service Agreement
 * (repair authorization / AOB, paint waiver, R&I liability, supplement
 * disclosure, storage/lien terms).
 *
 * Shared between the in-person mobile intake wizard and the remote AOB
 * signing page so both execution paths present identical legal terms. Any
 * lead/vault metadata already captured is auto-populated into a header line.
 */
export function AobAgreementText(props: AobAgreementTextProps = {}) {
  return (
    <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-[11px] leading-relaxed text-zinc-400">
      <p className="font-semibold text-zinc-200">
        Specialized PDR &amp; Auto Hail Repair Service Agreement
      </p>
      <AgreementHeader {...props} />
      <p>
        <span className="font-semibold text-zinc-300">(a) Repair Authorization &amp; Assignment of Benefits (AOB).</span>{' '}
        I authorize the shop to perform repairs and assign my insurance benefits to the
        shop for direct payout of the covered loss, including any approved supplements.
      </p>
      <p>
        <span className="font-semibold text-zinc-300">(b) PDR Paint Integrity Waiver.</span>{' '}
        I acknowledge that severe or stretched hail dents on weathered, aged, or
        previously repainted panels carry an inherent risk of paint micro-fracturing or
        chipping during metal manipulation. I release the shop from liability for
        pre-existing factory paint flaws or finish failure attributable to panel age or
        prior refinish.
      </p>
      <p>
        <span className="font-semibold text-zinc-300">(c) R&amp;I (Removal &amp; Installation) Liability.</span>{' '}
        I authorize dropping headliners and removing interior trim, lamps, and glass as
        needed, and waive liability for aged or brittle plastic clips, fasteners, or
        electronic sensors that may fail during a hail teardown.
      </p>
      <p>
        <span className="font-semibold text-zinc-300">(d) Hail Supplement &amp; Blueprinting Disclosure.</span>{' '}
        I understand initial carrier drive-by or photo estimates commonly miss hidden
        hail damage (underside bracing, unpainted aluminum panels, edge damage), and I
        authorize a light-board scope and the submission of direct carrier supplements.
      </p>
      <p>
        <span className="font-semibold text-zinc-300">(e) Storage, Security &amp; Mechanic&apos;s Lien.</span>{' '}
        Vehicles left after completion or authorization withdrawal may accrue daily
        storage fees, and the shop may exercise a mechanic&apos;s lien for unpaid
        authorized charges as permitted by law.
      </p>
    </div>
  );
}
