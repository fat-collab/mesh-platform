# MESH Platform — Schema & Data Architecture Overview

> Consolidated map of the database schema, persistence layers, data-access
> modules, type declarations, API routes, and env vars. Generated from the
> migrations, `src/lib`, and `src/components/*/types.ts`.

## Architecture at a glance

- **Database:** Supabase **Postgres** — schema defined by SQL migrations in
  `supabase/migrations/` (no Prisma/Drizzle). Types are **hand-authored** in
  `src/lib/database.types.ts` (mirrors the migrations; `supabase gen types`
  is not wired up in this environment).
- **Data access:** **per-feature modules** in `src/lib/` — no central store.
  Each is **DB-first with a graceful fallback** (session-memory or a temp-dir
  JSON file) so the app runs without applied tables / external keys.
- **Types:** split by feature (`src/components/*/types.ts` + `src/lib/audit/types.ts`
  + `src/lib/database.types.ts`) — no `src/types/index.ts`.

### Migration application status
`20260101000000_init_mesh.sql` was pushed & seeded to the hosted project (per
project memory). The **incremental migrations added since** (resolution reason,
parts, intake leads, rental vehicles, the Catastrophe Hub columns +
`commission_overrides`, the Legal & Carrier Intelligence Shield columns +
`remote_aob_links`) have **not** been applied to the hosted DB (no DDL access
here), so those features currently run in **local/fallback mode** until
applied via the Supabase SQL editor or `supabase db push`.

---

## 1. Database schema (Supabase)

### Enums (`init_mesh`)
| Enum | Values |
|---|---|
| `user_role` | TECH, MANAGER, ADJUSTER, CUSTOMER, EXECUTIVE |
| `ro_stage` | INTAKE, TEARDOWN, HOLD_CARRIER, PDR_REPAIR, HOLD_PARTS, ADAS_SUBLET, HOLD_TOTAL_LOSS, QC_DELIVERY |
| `hold_gate_type` | CARRIER_SUPPLEMENT, PARTS_BACKORDER, TOTAL_LOSS_REBUTTAL |
| `payout_status` | PENDING, PROCESSING, PAID, FAILED, REVERSED |
| `payout_split_role` | PDR_LEAD (50%), SALES (10%), HOUSE (40%) |

### Core tables (`20260101000000_init_mesh.sql`)
All carry `created_at` / `updated_at` (a `set_updated_at` trigger touches
`updated_at`). Multi-tenant via `organization_id` + RLS helper
`current_user_org_id()`.

| Table | Key columns |
|---|---|
| `organizations` | id, name, setup_completed, shop_email, shop_phone, tax_id, tos_accepted_at, tos_version, tos_accepted_ip |
| `locations` | id, organization_id, name, address |
| `users` | id, auth_user_id, organization_id, role, full_name, email |
| `vehicles` | id, vin, make, model, year, paint_code |
| `repair_orders` | id, organization_id, location_id, vehicle_id, customer_name, claim_number, stage, hold_gate_active |
| `total_loss_audits` | id, ro_id, organization_id, acv_amount, conventional_estimate, pdr_estimate, risk_score, state_threshold_pct |
| `hold_gate_logs` | id, ro_id, organization_id, gate_type, locked_at, unlocked_at, resolved_by, **resolution_reason** |
| `proof_of_payments` | id, ro_id, organization_id, check_amount, check_image_url, ocr_verified_flag |
| `payout_splits` | id, ro_id, organization_id, tech_user_id, split_role, gross_amount, tech_split_pct, net_payout, stripe_transfer_id, status |

Triggers of note: `sync_hold_gate_active` (re-derives `repair_orders.hold_gate_active`
from stage), `compute_risk_score` / `net_payout` derivations, RO-child
`organization_id` auto-population.

### Added tables (incremental migrations)
**`parts_line_items`** (`20260725000000`) — parts ops + invoice + discrepancy
> id, claim_number, part_number, description, vendor_name, quantity, unit_cost,
> status, sourcing_tier, capa_certified, invoice_number, invoice_url,
> received_at, discrepancy_reason, discrepancy_notes, return_rma_number,
> replacement_expected_date, created_at

**`intake_leads`** (`20260726000000`) — sales pipeline + mobile intake
> id, customer_name, phone, email, vehicle_year, vehicle_make, vehicle_model,
> vehicle_info, vin, claim_number, insurance_carrier, estimated_amount,
> documents (jsonb), walkaround_notes (jsonb), signature_url, status,
> agreement_accepted, assigned_staff_id, assigned_staff_name, created_at

**`rental_vehicles`** (`20260726000100`) — loaner fleet
> id, make_model, license_plate, status, starting_mileage, current_mileage,
> fuel_level, assigned_ro_id, assigned_customer, assigned_agent,
> expected_return_date, updated_at

**`intake_leads` — Catastrophe Hub columns** (`20260730010000_catastrophe_hub.sql`)
> channel (CHECK: DIGITAL_INBOUND / FIELD_DISPATCH — which Sales & Intake hub
> tab a lead belongs to; existing rows backfilled to DIGITAL_INBOUND),
> storm_tag, zip_code (storm/campaign attribution), severity (CHECK: MINOR /
> MODERATE / SEVERE / CATASTROPHIC — instant digital-intake rating),
> damage_photos (jsonb, `IntakeDocumentRef[]`), routing_path (CHECK:
> SHOP_DROPOFF / MOBILE_HOUSE_CALL — the post-contact dual-path routing
> decision), dispatch_staff_name, dispatch_status (CHECK: DISPATCHED /
> EN_ROUTE / ON_SITE / COMPLETED — field dispatch lifecycle, mobile path only).

**`commission_overrides`** (`20260730010000_catastrophe_hub.sql`) — executive
override layer over `payout_splits.tech_split_pct` (SALES legs)
> id, organization_id (FK → organizations, nullable), user_id (text, not a
> FK — staff ids in this app are free-text, e.g. 'staff-avery'), ro_id (text,
> not a FK — local/demo ROs carry non-uuid ids, e.g. 'mock-a6f1'), split_role
> (`payout_split_role`, default SALES), override_pct, set_by, created_at,
> updated_at. CHECK requires at least one of user_id / ro_id. RLS: select
> open (authenticated + anon); insert/update/delete require
> `current_user_is('EXECUTIVE')`. A reporting/override view only — never
> mutates the underlying `payout_splits` row.

**`intake_leads` — Legal & Carrier Intelligence Shield columns**
(`20260730020000_legal_carrier_shield.sql`)
> policyholder_match (boolean, default true — Named Insured / Policyholder
> Match), proxy_policyholder (jsonb — `ProxyPolicyholder`, set when match is
> false), remote_aob_status (CHECK: NOT_SENT / SENT / SIGNED), remote_aob_token
> (the active `remote_aob_links.token` for this lead, if any). Carrier
> lowball/supplement risk profiles and the dynamic per-carrier photo
> checklist (VIN-to-damage alignment, line-board sweep, etc.) are static
> in-code reference data (`src/lib/carrier-intel.ts`), not persisted — the
> captured checklist photos land in `intake_leads.documents` like any other
> `IntakeDocumentRef`.

**`remote_aob_links`** (`20260730020000_legal_carrier_shield.sql`) — Remote
AOB Secure Signing Link
> token (text, primary key — the URL slug), lead_id (text, not a FK — same
> non-uuid-safe reasoning as `commission_overrides.ro_id`), organization_id
> (FK → organizations, nullable), proxy_full_name, proxy_relationship,
> proxy_phone, proxy_email, status (CHECK: PENDING / SIGNED / EXPIRED),
> signature_url, created_at, signed_at. RLS is permissive to `anon` by
> design — the off-site proxy policyholder who opens `/remote-aob/[token]`
> has no MESH account, so the token itself (not a session) is the security
> boundary. Signing calls the same `updateLeadStatus(..., 'AOB_SIGNED')`
> business rule the in-person mobile wizard triggers on-site, so the
> auto-convert-to-RO rule fires identically regardless of signing path.

**`order_assignments`** (`20260727000000`) — relational RO staffing (multi-role)
> id, repair_order_id (FK → repair_orders), staff_id, staff_name,
> role (`staff_role` enum: SALES / ESTIMATOR / BODY_TECH / PAINTER / FOREMAN),
> assigned_at. Seeded with a SALES row from the lead's intake owner on
> `convertLeadToRO`. The board card shows the single owner denormalized; this
> table carries the full floor staffing.

**`repair_order_parts`** (`20260727000200`) — RO-scoped parts procurement
> id, repair_order_id (FK → repair_orders, ON DELETE CASCADE), part_name,
> part_number, vendor, part_type (CHECK: OEM / AFTERMARKET / SALVAGE / USED),
> status (CHECK: NEEDED / ORDERED / SHIPPED / RECEIVED / RETURNED), cost, eta,
> created_at. Distinct from the claim-scoped `parts_line_items`
> estimate/discrepancy layer; models the `RepairOrderPart` type in
> `ro-parts-types.ts`.

**`repair_order_supplements`** (`20260727000300`) — ⚠ **DEPRECATED / unused**.
> The thin RO-scoped supplement ledger was retired in favor of the richer
> claim-scoped `supplement_records` (`supplement-db.ts` / `SupplementRecord`),
> which now feeds the RO drawer, invoicing, and analytics. The `supplements-db.ts`
> DAL and `ro-supplements-types.ts` were removed; the migration file remains for
> history but the table is no longer written or read.

**`repair_order_labor`** (`20260727000400`) — RO-scoped labor & time tracking
> id, repair_order_id (FK → repair_orders, ON DELETE CASCADE), operation_name,
> technician_name, estimated_hours, actual_hours,
> status (CHECK: PENDING / IN_PROGRESS / COMPLETED), clocked_in_at, clocked_out_at,
> created_at. Feeds the shop efficiency ratio; models `RepairOrderLaborEntry` in
> `ro-labor-types.ts`.

**`repair_order_invoices`** (`20260727000500`) — RO-scoped invoicing / A/R
> id, repair_order_id (FK → repair_orders, ON DELETE CASCADE), invoice_number,
> status (CHECK: DRAFT / SENT / PAID / VOID), subtotal, tax, total, paid_at,
> created_at. Accounts receivable: rolls up base + parts + approved supplements +
> labor into subtotal/tax/total and tracks payment status. One invoice per RO;
> models `RepairOrderInvoice` in `ro-invoice-types.ts` (DAL: `invoice-db.ts`).

**`repair_order_comms`** (`20260727000600`) — RO-scoped customer comms log
> id, repair_order_id (FK → repair_orders, ON DELETE CASCADE),
> channel (CHECK: SMS / EMAIL / PHONE / NOTE),
> direction (CHECK: INBOUND / OUTBOUND), recipient, content, sender_name,
> created_at. Inbound/outbound customer-comms timeline; models
> `RepairOrderCommEntry` in `ro-comms-types.ts` (DAL: `comms-db.ts`).

### Procurement — pure job-costing (`20260728000700` + `20260730000000_inventory_lockdown.sql`)
⚠ **The generalized warehouse catalog was removed** (`20260730000000_inventory_lockdown.sql`,
"Downstream Lockdown"): `suppliers`, `parts_catalog`, `supplier_parts`, and
`purchase_order_items.part_id` are all **dropped**. No SKU/stock-level
inventory concept exists in this app — every part line item is strictly
coupled to a repair order. DAL: `procurement-db.ts`; types: `procurement-types.ts`.

**`purchase_orders`** — id, repair_order_id (uuid, FK → repair_orders, **NOT
> NULL**, ON DELETE CASCADE), vin (text, **NOT NULL** — a snapshot captured
> from the RO's vehicle at PO-creation time, not live-joined, so it won't drift
> if the vehicle record is later edited), status (CHECK: DRAFT / SENT /
> RECEIVED), created_at. `generatePurchaseOrder()` throws if either
> repair_order_id or vin is missing — enforced in both the DB and
> local-fallback paths (job-costing gate).
**`purchase_order_items`** — id, po_id (FK → purchase_orders), part_line_id
> (FK → parts_line_items, nullable — the claim-scoped estimate line this PO
> line fulfills), quantity, unit_price.

**`supplement_records`** (`20260728000900`) — canonical carrier supplement claims
> id (text, app-generated), ro_id, customer_name, vehicle_info, insurance_carrier,
> claim_number, lifecycle_status (CHECK: DRAFT / SUBMITTED / APPROVED_PENDING_PAYMENT
> / PAID), items (jsonb — per-line category / original vs requested cost / status /
> photo), total_delta_amount, carrier_notes, adjuster_name, adjuster_phone,
> created_at. Single source for the Supplements dashboard, RO drawer, invoicing,
> analytics, and the stage-gate financial-clearance rule (DAL: `supplement-db.ts`;
> type: `SupplementRecord`). Supersedes the deprecated `repair_order_supplements`.

> Not yet backed by a table (session/JSON only): **audit ledger**, **shop config**.

---

## 2. Persistence layers

| Concern | Primary (DB) | Fallback |
|---|---|---|
| Repair-order board | `repair_orders` (+joins) | `MOCK_BOARD_ORDERS` (mutable, also the sales→ops bridge target) |
| Parts line items | `parts_line_items` | session store in `ops-db` |
| Hold-gate audit stream | `hold_gate_logs` | `MOCK_AUDIT_LOG` |
| Sales leads / intake | `intake_leads` | session store in `sales-db` (+ intake packages) |
| RO staff assignments | `order_assignments` | session store in `assignments-db` (keyed by RO id) |
| RO parts procurement | `repair_order_parts` | session store in `parts-db` (keyed by RO id, seeded for `mock-a6f1`) |
| RO supplements | *(retired — unified into Carrier supplements below)* | — |
| RO labor / time tracking | `repair_order_labor` | session store in `labor-db` (keyed by RO id, seeded for `mock-a6f1`) |
| RO invoicing / A/R | `repair_order_invoices` | session store in `invoice-db` (one per RO, seeded for `mock-a6f1`) |
| RO customer comms | `repair_order_comms` | session store in `comms-db` (keyed by RO id, seeded for `mock-a6f1`) |
| Procurement (job-costing) | `purchase_orders`, `purchase_order_items` | seeded in-memory store in `procurement-db` (keyed by RO id, seeded for `mock-a6f1`) |
| Rental fleet | `rental_vehicles` | session store in `rental-db` (seeded from `MOCK_FLEET`) |
| Commission overrides (Catastrophe Hub) | `commission_overrides` | session store in `commission-db` |
| Remote AOB signing links | `remote_aob_links` | session store in `remote-aob-db` (keyed by token) |
| Carrier supplements (canonical) | `supplement_records` (`20260728000900`) | session store in `supplement-db` — feeds RO drawer, invoicing, analytics, stage-gates |
| Shop config | *(none yet)* | temp-dir JSON `mesh-shop-config.json` |
| Comms audit ledger | *(none yet)* | temp-dir JSON `mesh-audit-ledger.json` |
| Rebuttals / carrier tiers / OEM specs | — | static in-code data |

---

## 3. Data-access modules (`src/lib`)

| Module | Exports |
|---|---|
| `ops-data.ts` | mapRowToBoardOrder, fetchBoardOrders, persistStage, persistUnlock |
| `ops-db.ts` | fetchPartsByClaim, importEstimateLineItems, updatePartStatus, markPartReceived, flagPartDiscrepancy, fetchHoldGateLogs, getSupplementsForClaim, saveSupplementPackage |
| `sales-db.ts` | getLeads, saveIntakePackage, createDigitalLead, updateLeadStatus, updateLeadRouting, updateDispatchStatus, assignLeadStaff, markRemoteAobDispatched, convertLeadToRO, resurrectAndConvertLead |
| `commission-db.ts` | getCommissionLedger, getCommissionOverrides, setCommissionOverride |
| `carrier-intel.ts` | getCarrierIntel, CHECKLIST_ITEM_LABEL (carrier lowball/supplement risk + dynamic photo checklist — distinct from carrier-tiers.ts's FNOL automation tier) |
| `remote-aob-db.ts` | createRemoteAobLink, getRemoteAobLink, signRemoteAobLink |
| `assignments-db.ts` | getAssignments, assignStaff, removeAssignment |
| `parts-db.ts` | getParts, addPart, updatePartStatus, removePart |
| `labor-db.ts` | getLaborEntries, addLaborEntry, toggleClock, updateActualHours, removeLaborEntry |
| `invoice-db.ts` | getInvoice, generateInvoice, updateInvoiceStatus |
| `comms-db.ts` | getCommEntries, addCommEntry |
| `procurement-db.ts` | getPartsRequestQueue, getActivePurchaseOrders, generatePurchaseOrder, updatePurchaseOrderStatus |
| `stage-gates.ts` | validateStageTransition |
| `rental-db.ts` | getFleet, getAvailableVehicles, assignVehicle, addVehicle, removeVehicle, returnVehicle, setVehicleStatus |
| `supplement-db.ts` | getSupplements, getSupplementsForRO, approvedSupplementTotal, saveSupplement, deleteSupplement, updateSupplementStatus, getAgingSupplements, supplementAgingDays, computeTotalDelta, genSupplementId |
| `shop-config.ts` | getShopConfig, saveShopConfig |
| `audit/ledger.ts` | appendAuditEntry, getAuditLog |
| `carrier-tiers.ts` | classifyCarrier (+ CARRIER_TIER_META, CARRIER_TIER_TONE) |
| `rebuttals-data.ts` | REBUTTALS, REBUTTAL_CATEGORIES, REBUTTAL_CATEGORY_LABEL (static) |
| `vision/client.ts` | visionService, geminiExtractor, mockExtractor (Gemini OCR + mock) |
| `vapi-client.ts` | dispatchVapiCall (outbound AI calls + mock) |
| `webhooks/security.ts` | verifyVapiSecret, verifyWebhookSignature, checkIdempotency |
| `supabase.ts` | getSupabaseBrowserClient / getSupabaseServerClient / getSupabaseClient |

---

## 4. Type declarations

| File | Types |
|---|---|
| `src/lib/database.types.ts` | `Database` (all table Row/Insert/Update), enum aliases |
| `src/components/ops/types.ts` | PartStatus, PartSourcingTier, DiscrepancyReason, PartsLineItem, HoldCategory, HoldAction, AuditLogEntry (hold-stream), ScopeCategory, ScopeLineItem, SupplementPackage, StructuralMaterial, OEMSpecData, StaffRole, OrderAssignment |
| `src/components/ops/ro-parts-types.ts` | PartType, PartStatus (RO-scoped), PartsLabels, RepairOrderPart |
| `src/components/ops/ro-labor-types.ts` | LaborStatus, RepairOrderLaborEntry |
| `src/components/ops/ro-invoice-types.ts` | InvoiceStatus, RepairOrderInvoice |
| `src/components/ops/ro-comms-types.ts` | CommChannel, CommDirection, RepairOrderCommEntry |
| `src/components/inventory/procurement-types.ts` | ProcurementPOStatus, PartsRequestGroup, ProcurementPOItem, ProcurementPO |
| `src/components/sales/types.ts` | LeadStatus, IntakeLead, LeadChannel, StormSeverity, RoutingPath, DispatchStatus, ProxyPolicyholder, RemoteAobStatus, RentalStatus, RentalVehicle, RentalAssignmentInfo, IntakeDocKind, IntakeDocumentRef, WalkaroundItem, HailSeverity, HailPanelAssessment, IntakeSubmission |
| `src/lib/carrier-intel.ts` | LowballRisk, ChecklistItemId, CarrierIntel |
| `src/lib/remote-aob-db.ts` | RemoteAobLinkStatus, RemoteAobLinkRecord |
| `src/components/supplements/types.ts` | SupplementItemCategory, SupplementItemStatus, SupplementItem, SupplementLifecycle, SupplementRecord |
| `src/components/onboarding/types.ts` | StaffMember, PdrMatrixRow, OperatingHours, ShopConfig |
| `src/lib/audit/types.ts` | AuditChannel, AuditDirection, AuditLogEntry (comms ledger) |
| `src/lib/carrier-tiers.ts` | CarrierTier, CarrierTierInfo |
| `src/lib/vision/client.ts` | DocType, ExtractResult, VisionExtractor |

> ⚠ Two distinct `AuditLogEntry` types exist: the hold-gate activity stream
> (`components/ops/types.ts`) and the comms ledger (`lib/audit/types.ts`).
> They are never imported into the same module.
>
> ⚠ Likewise two distinct `PartStatus` (and `PART_STATUS_LABEL`) exist: the
> claim-scoped estimate/discrepancy layer (`components/ops/types.ts`:
> NEEDED/ORDERED/IN_TRANSIT/RECEIVED/DISCREPANCY) and the RO-scoped procurement
> layer (`components/ops/ro-parts-types.ts`: NEEDED/ORDERED/SHIPPED/RECEIVED/
> RETURNED). Kept in separate modules; not barrel-exported together.

---

## 5. API routes (`src/app/api`)

| Route | Purpose |
|---|---|
| `POST /api/v1/vision/ocr` | Provider-abstracted OCR (VIN, insurance, supplement evidence, PDR grid, comp sheet) |
| `POST /api/v1/vapi/call` | Dispatch outbound AI call; logs to audit ledger |
| `POST /api/v1/webhooks/vapi` | Vapi call events → audit ledger (x-vapi-secret verify + idempotency) |
| `GET  /api/v1/audit/[claimId]` | Fetch audit timeline for a record |
| `GET/POST /api/v1/shop/config` | Shop profile & SOP config |
| `POST /api/v1/sales/leads/[leadId]/convert` | Convert approved lead → Ops RO |
| `POST /api/v1/sales/leads/[leadId]/remote-aob` | Create + email-dispatch a Remote AOB Secure Signing Link (Resend; SMS is mock-logged — no SMS provider exists in this app) |
| `POST /api/v1/payments/verify` | Proof-of-payment verification (Stripe/Supabase) |

Dashboard pages: `/dashboard/{ops, sales, fleet, supplements, rebuttals, payouts, settings}`.
Public pages (no auth, outside the dashboard tree): `/remote-aob/[token]` — the
proxy policyholder's Remote AOB Execution Gate.

---

## 6. Environment variables

| Var | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | server/seed scripts |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Resend email — register welcome email, Remote AOB signing-link dispatch (skipped/logged if unset) |
| `GEMINI_API_KEY` | vision OCR (else deterministic mock) |
| `VAPI_API_KEY` | outbound calls (else mock) |
| `VAPI_PHONE_NUMBER_ID`, `VAPI_ASSISTANT_ID`, `VAPI_ASSISTANT_SUPPLEMENT`, `VAPI_ASSISTANT_ACV` | call dispatch config |
| `VAPI_WEBHOOK_SECRET` | webhook `x-vapi-secret` verification (skipped if unset) |
| `NEXT_PUBLIC_VAPI_PUBLIC_KEY` | reserved for a future Vapi Web SDK |
