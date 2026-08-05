# MESH — Pre-Launch Security Checklist

Status legend: **[ ]** not started · **[~]** in progress · **[x]** done

Nothing on this list is theoretical. Every item traces to something found in the
codebase or decided during review.

---

## 1. Credentials and keys

- [x] Remove hardcoded credentials from source. A live `service_role` JWT was
      committed in `src/lib/supabase.ts` and shipped to the browser via the
      `NEXT_PUBLIC_` prefix.
- [x] Migrate to publishable/secret API keys and deactivate the legacy anon and
      service_role JWTs.
- [x] Fail loudly on missing credentials. No `|| fallbackKey` — a missing env var
      must break the build, never silently downgrade or escalate privilege.
- [x] Move the service-role client behind `import 'server-only'` so it cannot be
      bundled into client code.
- [ ] Rotate the Resend API key.
- [ ] Rotate the Vapi private API key (`VAPI_API_KEY`; the `NEXT_PUBLIC_` Vapi key
      is public by design).
- [ ] Document a key rotation procedure: which keys exist, where each is set
      (local, Vercel, CI), and the order to update them without an outage.
- [ ] Confirm no secret appears in git history on any branch before the repo is
      shared with anyone outside the team.
- [ ] Verify `.env*` is gitignored in every environment and that no `.env` file
      has ever been committed.

## 2. Tenant isolation (Row Level Security)

- [x] Organization-scope every table holding customer data.
- [x] Add a `SALES` role and apply a per-table access matrix.
- [x] Split `repair_orders` and `vehicles` write policies into insert/update/delete
      so a role can create without being able to edit afterward.
- [ ] Revoke `grant select on all tables in schema public to anon` once every table
      is either scoped or confirmed permissive by design.
- [ ] Give `rental_vehicles` a real `organization_id` column and scope it. It is
      currently permissive because no reliable org path exists.
- [ ] Scope `supplement_records`. Its `ro_id` is loose text with no FK, so no join
      to an organization is currently possible.
- [ ] Write an isolation test: sign in as a user from Org A and confirm that every
      dashboard route returns zero rows belonging to Org B.
- [ ] Verify the access matrix under each role, not just `EXECUTIVE`. Navigate
      directly to restricted routes — UI nav gating is not enforcement.

## 3. Customer documents and PII

MESH stores driver's licenses, insurance cards, VINs, claim numbers, and
signatures. This section is the highest-value target in the system.

- [ ] **Move documents out of the database.** Base64 data URLs are currently
      written straight into `intake_leads.documents` (jsonb). One lead row reached
      22.6 MB. Upload to object storage and persist only a reference.
- [ ] Same for `damage_photos` (jsonb).
- [ ] Same for `signature_url` on `intake_leads` and `remote_aob_links` — the
      signature pad writes `canvas.toDataURL()` directly into the column.
- [ ] Choose signed URLs over a public bucket. These are identity documents; a
      public bucket puts them at guessable URLs with no expiry.
- [ ] Scope storage paths per organization and enforce it with policies on
      `storage.objects`, not just path convention.
- [ ] Add a size guard that rejects or warns on oversized payloads before write,
      so this class of problem cannot silently recur.
- [ ] Set a document retention policy and a deletion path — what happens to a
      customer's license photo after the repair closes.

## 4. Public and unauthenticated surfaces

- [ ] Harden the remote AOB signing link. `remote_aob_links` is deliberately
      anon-accessible so an off-site policyholder can sign without an account, but
      the token is stored in plaintext with no expiry. Hash the token and add an
      expiry window.
- [ ] Rate-limit the public signing and invite-accept endpoints.
- [ ] Audit every unauthenticated route that holds a service-role client. Confirm
      each is strictly token-keyed and never accepts a record id from the caller.
- [ ] Confirm the invite accept flow cannot be used to self-assign a role. Role and
      organization must come from the invite row only, never the request body.

## 5. Audit and accountability

- [ ] Wire `audit_logs` to sensitive reads — who viewed which customer document,
      and when.
- [ ] Log privileged writes performed by server actions, including who triggered
      them.
- [ ] Record a reason and an actor on any correction to a claim number, agreement,
      or converted repair order after it leaves INTAKE.
- [ ] Make signed agreements immutable. A signature record must not be editable
      after the fact.

## 6. Operational readiness

- [ ] Remove the mock-data fallback from production paths. The Ops board currently
      renders sample repair orders whenever a query errors *or* returns zero rows,
      with no environment guard — staff could work a shift off fabricated data.
- [ ] Distinguish "no data yet" from "access denied" in every view.
- [ ] Test a backup restore. Not "backups are enabled" — an actual restore into a
      scratch project, timed.
- [ ] Document the incident procedure: who rotates what, in what order, and how a
      customer is notified.
- [ ] Confirm environment variables are correctly set in every deploy target before
      the first client build.
- [ ] Remove or repoint the Ops-side direct intake so no repair order can be created
      without a lead, an owner, a checklist, and a signed agreement.

## 7. Data ownership and exit

- [ ] Write the answer to "what happens if a shop leaves" — how they export their
      data, in what format, and how their data is deleted afterward.
- [ ] Define what MESH does and does not do with shop data. Put it in writing before
      a client asks.
- [ ] Confirm no shop's data is used to seed, train, or demo anything for another
      shop.

---

## Before the first live client

The minimum bar. Do not onboard a paying shop until these are true:

1. Documents live in object storage behind signed URLs, not in database columns.
2. Every table holding customer data is organization-scoped, and the `anon` grant
   is revoked.
3. The access matrix is verified under each role by direct route navigation.
4. Mock data cannot render in production under any condition.
5. All keys rotated after development, with a documented rotation procedure.
6. A backup restore has been performed successfully at least once.
7. Tenant isolation is proven by test, not by inspection.
