# MESH — Features

An operating system for automotive hail repair: paintless dent repair, storm
response, and field dispatch.

Status legend: **Built** · **Partial** · **Planned**

---

## Field Intake

Capture a lead at the doorstep in under a minute, on a phone, on a bad connection.

- **Built** — Mobile intake wizard: customer, vehicle, VIN, carrier, claim, hail
  matrix by panel, pre-existing damage walkaround, document capture, e-signature.
- **Built** — Quick lead capture: name only. Nothing else is required to save.
- **Built** — Digital inbound intake for online and phone leads.
- **Built** — VIN capture from a photo.
- **Planned** — Carrier picker replacing free-text entry, so a typo cannot silently
  downgrade the documentation requirements.

**Design rule:** the form never blocks the field. Only a customer name is required.
Everything else is optional at capture and enriched later.

## Multi-Vehicle Households

A storm hits a driveway, not a car. Most properties have more than one damaged
vehicle.

- **Built** — Capture multiple vehicles against a single lead.
- **Planned** — One repair order per vehicle, fanned out at conversion, with
  per-vehicle claim numbers.
- **Planned** — Per-vehicle authorization: one signer may cover several vehicles,
  and a household may have several authorized signers.

## Pipeline and Lead Management

- **Built** — Kanban board across active stages, with dead-lead states retained for
  storm re-targeting.
- **Built** — Lead detail view: edit customer, vehicle, insurance, and claim
  details after intake; upload missing documents; reassign ownership.
- **Built** — Lead ownership tracked to a real user account, carried through to the
  repair order.
- **Planned** — Simplified rep-facing statuses: captured, contacted, signed,
  converted, plus lost with a reason.

## Compliance Gates

Work does not start on a vehicle that is not properly authorized.

- **Built** — Carrier-specific documentation checklists. Requirements differ by
  carrier and by claim risk profile.
- **Built** — The checklist is enforced at conversion, not at capture, so a rep
  never loses a lead over a document the customer does not have on hand.
- **Built** — Repair authorization and rental agreements are separate legal
  documents with separate signatures.
- **Planned** — Per-organization configuration of which requirements block
  conversion and which merely warn. A signed agreement always blocks.

## Remote Signature

The person who answers the door is often not the titleholder.

- **Built** — Send a signing link to an off-site policyholder by email; they sign
  without needing an account.
- **Built** — The agreement shows the vehicle, claim, carrier, and policy being
  authorized.
- **Planned** — Hashed tokens with expiry.

## Loaner Fleet

- **Built** — Fleet inventory with reservation and pickup confirmation.
- **Built** — Loaner driver capture: name, driver's license, proof of insurance.
  The driver may be a different person from the repair authorizer.
- **Built** — Configurable handover gate. Each requirement can be set to not
  required, attested data, or an uploaded document — so a shop whose fleet policy
  covers permissive drivers is not forced to collect insurance it does not need.
- **Built** — Keys are held when a required document is missing; the vehicle stays
  reserved and is released once the document arrives. The lead always saves.
- **Planned** — Third-party rental tracking: agency, reservation number, and dates,
  so the shop can answer a rental provider's call about completion timing.
- **Planned** — Calendar-based reservation.

## Production Floor

- **Built** — Repair order board by stage, with hold gates.
- **Built** — Parts, labor, supplements, and communications per repair order.
- **Built** — Technician assignment and staffing.
- **Planned** — Rep-facing simplified view: where is my customer's vehicle, and
  what is holding it up.

## The Vehicle File

- **Planned** — The digital equivalent of the manila folder every shop keeps per
  car: service agreements, rental agreement, scope sheet, insurance estimates and
  supplements, parts receipts, glass, paint and body, third-party services, detail,
  promotional costs, and every other expense to fully repair that vehicle.
- **Planned** — This file is also the ledger that commission settlement reads from.

## Team and Roles

- **Built** — Invite teammates by email with an assigned role. The role is set by
  the person inviting and cannot be self-assigned.
- **Built** — Roles: executive, manager, adjuster, technician, sales.
- **Built** — Per-role access enforced at the database, not only in the interface.
- **Planned** — Rep-facing filtered views across every page, so a salesperson sees
  their own customers rather than the whole shop.

## Commission Settlement — *upgrade tier*

- **Planned** — Per-rep commission rates set by the shop owner.
- **Planned** — Net-margin calculation from the vehicle file: what insurance
  actually paid, less every expense attached to that vehicle.
- **Planned** — Running projection while a job is open, final once all payments —
  including rental reimbursement — have settled.
- **Planned** — A rep sees their own numbers only.

## Knowledge Base

- **Partial** — Carrier rebuttal library for prompt payment, total loss, PDR matrix,
  and OEM parts disputes.
- **Planned** — Expand into a full reference: PDR technique, carrier-specific
  quirks, matrix guidance, and shop-authored entries — so institutional knowledge
  stays with the shop when a good estimator leaves.

---

## Security and Data Protection

Shops handle their customers' driver's licenses, insurance cards, VINs, and claim
numbers. Most shop software treats that casually. MESH does not.

### Built

- **Tenant isolation at the database.** Every table holding customer data is scoped
  to the shop that owns it, enforced by Postgres row-level security — not by
  application code that can be bypassed. One shop cannot read another's leads,
  vehicles, repair orders, or documents, regardless of what any client requests.
- **Role-based access, enforced server-side.** A salesperson cannot read invoices or
  purchase orders. A technician cannot see commission. Hiding a menu item is not
  security; these restrictions hold at the data layer.
- **Least-privilege by construction.** Privileged operations run through
  server-side actions that verify the caller independently. Administrative
  credentials are never present in browser code and cannot be bundled into it.
- **Fail-closed defaults.** Missing configuration stops the application rather than
  degrading to weaker permissions. A missing credential is a hard failure, never a
  silent downgrade.
- **Scoped invitations.** Team invites carry the role assigned by the inviter. The
  invited person cannot elevate their own permissions, expired invites are rejected
  server-side, and each invite is single-organization.
- **Compliance gates that cannot be skipped.** Work cannot begin on a vehicle
  without a signed authorization on file.

### Planned

- **Customer documents in encrypted object storage** behind expiring signed URLs,
  scoped per shop — never in a shared database column.
- **Audit trail on sensitive access:** who viewed which customer document, and when.
- **Immutable signature records.** Once an authorization is signed, it cannot be
  altered.
- **Retention and deletion policy** for customer identity documents.
- **Documented data ownership and export.** A shop's data is theirs. Leaving means
  taking it with you and having it deleted.

### Commitments

- A shop's data is never used to seed, demo, or train anything for another shop.
- Credentials are rotated on a documented schedule.
- Backup restoration is tested, not assumed.
- Security review happens before each client onboarding, against a written
  checklist.
