# MESH — Naming & Schema Audit

Read-only audit. No source file was edited, created, or deleted in producing this document. All citations are `file:line` against the repository state at commit-time of migration `20260801010000_lead_vehicles.sql` (latest at time of writing).

---

## 1. SCHEMA INVENTORY

**Source used: `supabase/migrations/*.sql` (33 files, traced in filename-timestamp order), not `src/lib/database.types.ts`.**

Reason: `database.types.ts` is confirmed stale. It was last modified 2026-07-29 (`git log`) and contains no trace of `lead_vehicles`, `intake_leads.damage_type`, or `intake_leads.address` — all added by migrations dated 2026-07-31 and 2026-08-01. Its own `address` field (`src/lib/database.types.ts:107,115,123`) belongs to `locations`, not `intake_leads` — a different table entirely. It also predates `rental_vehicles`' `RESERVED` status value (`supabase/migrations/20260731000000_rental_reserved_status.sql`). No live DB dump was available as an alternative source — see note at the end of this section.

Three tables were created and later dropped (`suppliers`, `parts_catalog`, `supplier_parts` — see end of section); they do not appear in the current schema and are excluded from the main inventory except where they explain a dangling FK.

### organizations
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| name | text | no | none | — |
| created_at | timestamptz | no | `now()` | — |
| updated_at | timestamptz | no | `now()` | — |
| tos_accepted_at | timestamptz | yes | none | — |
| tos_version | text | yes | none | — |
| tos_accepted_ip | text | yes | none | — |
| setup_completed | boolean | no | `false` | — |
| shop_email | text | yes | none | — |
| shop_phone | text | yes | none | — |
| tax_id | text | yes | none | — |

CREATE `supabase/migrations/20260101000000_init_mesh.sql:81-86`; ALTER (7 cols) `20260729000000_organizations_onboarding.sql:10-29`.

### locations
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| organization_id | uuid | no | none | organizations.id |
| name | text | no | none | — |
| address | text | yes | none | — |
| created_at | timestamptz | no | `now()` | — |
| updated_at | timestamptz | no | `now()` | — |

CREATE `20260101000000_init_mesh.sql:89-96`. No later ALTERs.

### users
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| auth_user_id | uuid | no | none | auth.users.id (unique) |
| organization_id | uuid | no | none | organizations.id |
| role | `user_role` enum | no | `'TECH'` | — |
| full_name | text | yes | none | — |
| email | text | yes | none | — |
| created_at | timestamptz | no | `now()` | — |
| updated_at | timestamptz | no | `now()` | — |

CREATE `20260101000000_init_mesh.sql:100-109`. No later ALTERs.

### vehicles
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| organization_id | uuid | no | none | organizations.id |
| vin | text | yes | none | — |
| make | text | yes | none | — |
| model | text | yes | none | — |
| year | smallint | yes | none | — |
| paint_code | text | yes | none | — |
| created_at | timestamptz | no | `now()` | — |
| updated_at | timestamptz | no | `now()` | — |

CREATE `20260101000000_init_mesh.sql:113-124` (unique `(organization_id, vin)` at line 123). No later ALTERs.

### repair_orders
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| organization_id | uuid | no | none | organizations.id |
| location_id | uuid | yes | none | locations.id (set null) |
| vehicle_id | uuid | yes | none | vehicles.id (restrict) |
| customer_name | text | yes | none | — |
| claim_number | text | yes | none | — |
| stage | `ro_stage` enum | no | `'INTAKE'` | — |
| hold_gate_active | boolean | no | `false` | — |
| created_at | timestamptz | no | `now()` | — |
| updated_at | timestamptz | no | `now()` | — |
| closed_at | timestamptz | yes | none | — |
| financial_status | text | yes | none | — |
| final_approved_amount | numeric(12,2) | no | `0` | — |
| customer_deductible | numeric(12,2) | no | `0` | — |
| target_delivery_date | timestamptz | yes | none | — |

CREATE `20260101000000_init_mesh.sql:127-138`; ALTER (closed_at, financial_status) `20260728001000_repair_order_closeout.sql:9-14`; ALTER (final_approved_amount, customer_deductible) `20260728001100_repair_order_amounts.sql:9-13`; ALTER (target_delivery_date) `20260728140000_repair_orders_eta.sql:8-9`.

### total_loss_audits
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| ro_id | uuid | no | none | repair_orders.id (cascade) |
| organization_id | uuid | no | none | none declared (trigger-populated) |
| acv_amount | numeric(12,2) | yes | none | — |
| conventional_estimate | numeric(12,2) | yes | none | — |
| pdr_estimate | numeric(12,2) | yes | none | — |
| risk_score | numeric(12,4) | yes | none | — |
| state_threshold_pct | numeric(5,2) | yes | none | — |
| created_at | timestamptz | no | `now()` | — |
| updated_at | timestamptz | no | `now()` | — |

CREATE `20260101000000_init_mesh.sql:142-153`. No later ALTERs.

### hold_gate_logs
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| ro_id | uuid | no | none | repair_orders.id (cascade) |
| organization_id | uuid | no | none | none declared (trigger-populated) |
| gate_type | `hold_gate_type` enum | no | none | — |
| locked_at | timestamptz | no | `now()` | — |
| unlocked_at | timestamptz | yes | none | — |
| resolved_by | uuid | yes | none | users.id (set null) |
| resolution_reason | text | yes | none | — |
| created_at | timestamptz | no | `now()` | — |
| updated_at | timestamptz | no | `now()` | — |

CREATE (incl. `resolution_reason` already present) `20260101000000_init_mesh.sql:156-169`. Note: `20260724120000_add_hold_gate_resolution_reason.sql:10-11` re-adds the same column `IF NOT EXISTS` — a dead/no-op migration; its timestamp prefix (`20260724`) predates `init_mesh.sql`'s (`20260101`) only in month/day, not enough to run first (both 2026; `0724 > 0101`), so it applies after and does nothing.

### proof_of_payments
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| ro_id | uuid | no | none | repair_orders.id (cascade) |
| organization_id | uuid | no | none | none declared (trigger-populated) |
| check_amount | numeric(12,2) | yes | none | — |
| check_image_url | text | yes | none | — |
| ocr_verified_flag | boolean | no | `false` | — |
| created_at | timestamptz | no | `now()` | — |
| updated_at | timestamptz | no | `now()` | — |

CREATE `20260101000000_init_mesh.sql:172-181`. No later ALTERs.

### payout_splits
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| ro_id | uuid | no | none | repair_orders.id (cascade) |
| organization_id | uuid | no | none | none declared (trigger-populated) |
| tech_user_id | uuid | yes | none | users.id (set null) |
| split_role | `payout_split_role` enum | yes | none | — |
| gross_amount | numeric(12,2) | no | none | — |
| tech_split_pct | numeric(5,2) | no | none | — |
| net_payout | numeric(12,2) | yes | none (trigger-computed) | — |
| stripe_transfer_id | text | yes | none | — |
| status | `payout_status` enum | no | `'PENDING'` | — |
| created_at | timestamptz | no | `now()` | — |
| updated_at | timestamptz | no | `now()` | — |

CREATE `20260101000000_init_mesh.sql:185-198`. No later ALTERs.

### parts_line_items
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| claim_number | text | yes | none | none (loose text link, no FK) |
| part_number | text | yes | none | — |
| description | text | yes | none | — |
| vendor_name | text | yes | none | — |
| quantity | int | yes | none | — |
| unit_cost | numeric(12,2) | yes | none | — |
| status | text | no | `'NEEDED'` | — |
| sourcing_tier | text | no | `'OEM'` | — |
| capa_certified | boolean | yes | none | — |
| invoice_number | text | yes | none | — |
| invoice_url | text | yes | none | — |
| received_at | timestamptz | yes | none | — |
| discrepancy_reason | text | yes | none | — |
| discrepancy_notes | text | yes | none | — |
| return_rma_number | text | yes | none | — |
| replacement_expected_date | text | yes | none | — (TEXT, not a date type) |
| created_at | timestamptz | no | `now()` | — |

CREATE `20260725000000_parts_line_items.sql:11-34`. No later ALTERs.

### intake_leads
| column | type | null | default | FK |
|---|---|---|---|---|
| id | **text** | no | none | — |
| customer_name | text | no | none | — |
| phone | text | yes | none | — |
| email | text | yes | none | — |
| vehicle_year | int | yes | none | — |
| vehicle_make | text | yes | none | — |
| vehicle_model | text | yes | none | — |
| vehicle_info | text | yes | none | — |
| vin | text | yes | none | — |
| claim_number | text | yes | none | — |
| insurance_carrier | text | yes | none | — |
| estimated_amount | numeric(12,2) | yes | none | — |
| documents | jsonb | no | `'[]'` | — |
| walkaround_notes | jsonb | no | `'[]'` | — |
| signature_url | text | yes | none | — |
| status | text | no | `'NEW'` | — |
| agreement_accepted | boolean | no | `false` | — |
| assigned_staff_id | text | yes | none | — |
| assigned_staff_name | text | yes | none | — |
| created_at | timestamptz | no | `now()` | — |
| channel | text | yes | none | — |
| storm_tag | text | yes | none | — |
| zip_code | text | yes | none | — |
| severity | text | yes | none | — |
| damage_photos | jsonb | no | `'[]'` | — |
| routing_path | text | yes | none | — |
| dispatch_staff_name | text | yes | none | — |
| dispatch_status | text | yes | none | — |
| policyholder_match | boolean | no | `true` | — |
| proxy_policyholder | jsonb | yes | none | — |
| remote_aob_status | text | yes | none | — |
| remote_aob_token | text | yes | none | — |
| address | text | yes | none | — |
| damage_type | text | yes | none | — |

Table drop/recreate: `drop table if exists public.intake_leads cascade` then fresh CREATE — `20260726000000_intake_leads.sql:19-21` (comment: a stale out-of-band table with an incompatible `id` type existed; only this final layout is authoritative). CREATE (base 19 cols) `:21-44`. ALTER (channel..dispatch_status, 8 cols) `20260730010000_catastrophe_hub.sql:12-24`. ALTER (policyholder_match..remote_aob_token, 4 cols) `20260730020000_legal_carrier_shield.sql:11-16`. ALTER (address, damage_type) `20260801000000_quick_lead_capture.sql:11-13`.

### rental_vehicles
| column | type | null | default | FK |
|---|---|---|---|---|
| id | text | no | none | — |
| make_model | text | no | none | — |
| license_plate | text | yes | none | — |
| status | text | no | `'AVAILABLE'` | — |
| starting_mileage | int | yes | none | — |
| current_mileage | int | no | `0` | — |
| fuel_level | int | no | `100` | — |
| assigned_ro_id | text | yes | none | **not a declared FK** — see §6 |
| assigned_customer | text | yes | none | — |
| assigned_agent | text | yes | none | — |
| expected_return_date | text | yes | none | — (TEXT, not date) |
| updated_at | timestamptz | no | `now()` | — |

Table drop/recreate `20260726000100_rental_vehicles.sql:15-17`. CREATE `:17-31`. `status` CHECK widened to add `'RESERVED'` (constraint drop+add, no new column) `20260731000000_rental_reserved_status.sql:16-18`.

### order_assignments
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| repair_order_id | uuid | no | none | repair_orders.id (cascade) |
| staff_id | text | yes | none | — |
| staff_name | text | no | none | — |
| role | `staff_role` enum | no | none | — |
| assigned_at | timestamptz | no | `now()` | — |

CREATE `20260727000000_order_assignments.sql:29-36`. No later ALTERs.

### repair_order_parts / repair_order_supplements / repair_order_labor / repair_order_invoices / repair_order_comms

All five follow the identical shape: `id uuid PK default gen_random_uuid()`, `repair_order_id uuid not null references repair_orders(id) on delete cascade`, a `status text` with a table-specific default and CHECK, plus domain columns and `created_at timestamptz default now()`. No later ALTERs on any of the five.

- **repair_order_parts**: part_name, part_number, vendor, part_type (`'OEM'`), status (`'NEEDED'`), cost, eta (text). CREATE `20260727000200_repair_order_parts.sql:14-27`.
- **repair_order_supplements**: supplement_number, status (`'DRAFT'`), amount, adjuster_name, adjuster_phone, notes, submitted_at, approved_at. CREATE `20260727000300_repair_order_supplements.sql:14-27`.
- **repair_order_labor**: operation_name, technician_name, estimated_hours, actual_hours, status (`'PENDING'`), clocked_in_at, clocked_out_at. CREATE `20260727000400_repair_order_labor.sql:14-26`.
- **repair_order_invoices**: invoice_number, status (`'DRAFT'`), subtotal, tax, total, paid_at. CREATE `20260727000500_repair_order_invoices.sql:13-24`.
- **repair_order_comms**: channel, direction (`'OUTBOUND'`), recipient, content, sender_name. CREATE `20260727000600_repair_order_comms.sql:13-24`.

### purchase_orders
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| supplier_id | uuid | yes | none | **dangling** — was FK to `suppliers.id`; `suppliers` table dropped, constraint removed via cascade; column remains, unenforced |
| status | text | no | `'DRAFT'` | — |
| created_at | timestamptz | no | `now()` | — |
| repair_order_id | uuid | no | none | repair_orders.id (cascade) |
| vin | text | no | none | — |

`claim_number text` was added then dropped — not in final schema. CREATE (id, supplier_id, status, created_at) `20260728000700_inventory.sql:49-55`. ALTER add claim_number `20260728000800_po_ro_link.sql:12-13` (later dropped). ALTER add repair_order_id, vin (nullable) `20260730000000_inventory_lockdown.sql:25-29`; set NOT NULL `:40-43`; drop claim_number `:45-46`. `suppliers` dropped `:20`.

### purchase_order_items
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| po_id | uuid | no | none | purchase_orders.id (cascade) |
| quantity | int | no | `1` | — |
| unit_price | numeric(12,2) | no | `0` | — |
| part_line_id | uuid | yes | none | parts_line_items.id (set null) |

`part_id uuid references parts_catalog(id)` existed originally, dropped. CREATE `20260728000700_inventory.sql:57-63`. ALTER add part_line_id `20260728000800_po_ro_link.sql:18-20`. ALTER drop part_id `20260730000000_inventory_lockdown.sql:17`.

### supplement_records
| column | type | null | default | FK |
|---|---|---|---|---|
| id | text | no | none | — |
| ro_id | text | yes | none | none declared — loose, matched by ro_id or claim_number in app code per source comment |
| customer_name | text | no | none | — |
| vehicle_info | text | yes | none | — |
| insurance_carrier | text | yes | none | — |
| claim_number | text | yes | none | — |
| lifecycle_status | text | no | `'DRAFT'` | — |
| items | jsonb | no | `'[]'` | — |
| total_delta_amount | numeric(12,2) | no | `0` | — |
| carrier_notes | text | yes | none | — |
| adjuster_name | text | yes | none | — |
| adjuster_phone | text | yes | none | — |
| created_at | timestamptz | no | `now()` | — |

CREATE `20260728000900_supplement_records.sql:20-35`. No later ALTERs.

### insurance_payments
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| repair_order_id | uuid | no | none | repair_orders.id (cascade) |
| amount | numeric(12,2) | no | none | — |
| check_number | text | yes | none | — |
| status | text | no | `'PENDING'` | — (no CHECK constraint) |
| cleared_at | timestamptz | yes | none | — |
| created_at | timestamptz | no | `now()` | — |
| submitted_at | timestamptz | yes | `now()` | — |
| last_nudge_at | timestamptz | yes | none | — |
| nudge_count | int | no | `0` | — |
| stall_status | text | no | `'ACTIVE'` | — |

CREATE `20260728002000_insurance_payments.sql:1-9` — **note: this CREATE TABLE is unqualified (`insurance_payments`, not `public.insurance_payments`)**, the only table in the schema written this way; functionally fine (public is the default search_path schema) but inconsistent style. ALTER `20260728080000_ops_and_insurance_cadence.sql:23-34`. `stall_status` CHECK replaced (widened + data backfill) `20260728090000_upgrade_stall_tiers.sql:9-19`. RLS lockdown `20260728003000_privacy_shield.sql:29-36`, superseded `20260728005000_insurance_payments_role_policy.sql:13-24`.

### audit_logs
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| user_id | uuid | yes | none | none declared |
| action | text | yes | none | — |
| target_id | **text** | yes | none | none declared |
| metadata | jsonb | yes | none | — |
| created_at | timestamptz | no | `now()` | — |

CREATE (target_id originally uuid) `20260728003000_privacy_shield.sql:16-23`. ALTER target_id uuid→text `20260728004000_audit_logs_target_text.sql:9-10` (comment: audited targets aren't always uuids, e.g. `'mock-a6f1'`, claim numbers).

### subcontractor_milestones
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| repair_order_id | uuid | yes | none | repair_orders.id (cascade) |
| contractor_name | text | no | none | — |
| milestone_description | text | no | none | — |
| amount | numeric(12,2) | no | `0` | — |
| status | text | no | `'PENDING'` | — |
| released_at | timestamptz | yes | none | — |
| created_at | timestamptz | no | `now()` | — |

CREATE `20260728006000_subcontractor_milestones.sql:12-22`. No later ALTERs.

### ops_timelines
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| repair_order_id | uuid | yes | none | repair_orders.id (cascade) |
| event_type | text | no | none | — |
| description | text | no | none | — |
| metadata | jsonb | yes | none | — |
| created_at | timestamptz | no | `now()` | — |

CREATE `20260728080000_ops_and_insurance_cadence.sql:10-17`. No later ALTERs.

### customer_rentals
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| repair_order_id | uuid | yes | none | repair_orders.id (cascade) |
| rental_company | text | no | none | — |
| claimant_name | text | yes | none | — |
| policy_max_days | int | yes | none | — |
| rental_expiry_date | **date** | yes | none | — |
| daily_rate | numeric(10,2) | yes | none | — |
| status | text | no | `'ACTIVE'` | — |
| created_at | timestamptz | no | `now()` | — |

CREATE `20260728120000_fleet_and_rentals.sql:11-22`. No later ALTERs.

### rental_reimbursements
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| repair_order_id | uuid | yes | none | repair_orders.id (cascade) |
| provider_type | text | no | none | — |
| claimed_amount | numeric(12,2) | no | `0` | — |
| collected_amount | numeric(12,2) | no | `0` | — |
| status | text | no | `'PENDING'` | — |
| notes | text | yes | none | — |
| created_at | timestamptz | no | `now()` | — |

CREATE `20260728120000_fleet_and_rentals.sql:24-35`. No later ALTERs.

### commission_overrides
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| organization_id | uuid | yes | none | organizations.id (cascade) |
| user_id | text | yes | none | none declared |
| ro_id | text | yes | none | none declared |
| split_role | `payout_split_role` enum | no | `'SALES'` | — |
| override_pct | numeric(5,2) | no | none | — |
| set_by | text | yes | none | — |
| created_at | timestamptz | no | `now()` | — |
| updated_at | timestamptz | no | `now()` | — |

CREATE `20260730010000_catastrophe_hub.sql:43-54` (CHECK `user_id is not null or ro_id is not null` at line 53). Source comment: `user_id`/`ro_id` are plain text, not FKs, because repair orders from the local/demo bridge carry non-uuid ids (e.g. `'mock-a6f1'`).

### remote_aob_links
| column | type | null | default | FK |
|---|---|---|---|---|
| token | text | no | none | — (PK) |
| lead_id | text | no | none | none declared (loose ref to intake_leads.id) |
| organization_id | uuid | yes | none | organizations.id (cascade) |
| proxy_full_name | text | no | none | — |
| proxy_relationship | text | yes | none | — |
| proxy_phone | text | yes | none | — |
| proxy_email | text | yes | none | — |
| status | text | no | `'PENDING'` | — |
| signature_url | text | yes | none | — |
| created_at | timestamptz | no | `now()` | — |
| signed_at | timestamptz | yes | none | — |

CREATE `20260730020000_legal_carrier_shield.sql:31-44`. No later ALTERs.

### lead_vehicles
| column | type | null | default | FK |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | — |
| lead_id | **text** | no | none | intake_leads.id (cascade) — **declared, enforced FK** |
| vehicle_year | int | yes | none | — |
| vehicle_make | text | yes | none | — |
| vehicle_model | text | yes | none | — |
| vin | text | yes | none | — |
| severity | text | yes | none | — |
| created_at | timestamptz | no | `now()` | — |

CREATE `20260801010000_lead_vehicles.sql:15-24`. No later ALTERs.

### Dropped tables (historical only, do not exist in current schema)
- `suppliers` — CREATE `20260728000700_inventory.sql:24-29`; DROP `20260730000000_inventory_lockdown.sql:20`.
- `parts_catalog` — CREATE `:31-38`; DROP `:19`.
- `supplier_parts` — CREATE `:40-47`; DROP `:18`.

Note: `20260728000700_inventory.sql:18-22` itself opens with `drop table if exists` for `purchase_order_items`, `purchase_orders`, `supplier_parts`, `parts_catalog`, `suppliers` (clearing a stale out-of-band schema) before recreating — so the `purchase_orders`/`purchase_order_items` definitions above are the second generation of those tables.

---

## 2. ID TYPE MAP

| Column | Type | Citation |
|---|---|---|
| `intake_leads.id` | **text** | `supabase/migrations/20260726000000_intake_leads.sql:22` |
| `lead_vehicles.lead_id` | **text** | `supabase/migrations/20260801010000_lead_vehicles.sql:17` (`text not null references public.intake_leads(id) on delete cascade`) |
| `repair_orders.id` | **uuid** | `supabase/migrations/20260101000000_init_mesh.sql:128` |

**intake_leads.id vs lead_vehicles.lead_id: MATCH.** Both `text`; the FK is real and enforced (verified live — see cascade-delete test performed during this session's `lead_vehicles` migration rollout, not re-derived here from static analysis alone).

**intake_leads.id vs repair_orders.id: MISMATCH (text vs uuid).** No direct FK column links the two tables at all; the only connective tissue is `claim_number` (present on both, unique-per-org on the RO side via `repair_orders_org_claim_unique`, `20260101000000_init_mesh.sql:430-432`, with no uniqueness or FK constraint on the `intake_leads` side).

This same text-vs-uuid split recurs downstream, each time with an explicit source comment acknowledging it's deliberate (accommodating client-generated ids like `'lead-1001'` or local/mock board ids like `'mock-a6f1'`), not accidental:
- `supplement_records.ro_id` — text, no FK — `supabase/migrations/20260728000900_supplement_records.sql:22`.
- `commission_overrides.ro_id` — text, no FK — `20260730010000_catastrophe_hub.sql:47`.
- `rental_vehicles.assigned_ro_id` — text, no FK — `20260726000100_rental_vehicles.sql:26`; **seed data stores `intake_leads.id` values here** (`'lead-1004'`, `'lead-1002'`), not any `repair_orders.id` — the column is RO-labeled but lead-typed in practice (`:47-52`).
- `audit_logs.target_id` — widened uuid→text specifically for this reason — `20260728004000_audit_logs_target_text.sql:4-10`.

**Client-side ID generation.** Every `src/lib/*-db.ts` file defines its own near-identical `genId()`/`genUuid()`/`genToken()`/`genFleetId()` helper (`crypto.randomUUID()`, falling back to `` `${Date.now()}-${Math.random()}` `` when `crypto` is unavailable) rather than sharing one. Full list:

| File:line | Function | Prefix | Consumers (file:line) |
|---|---|---|---|
| `src/lib/sales-db.ts:109` | `genId(prefix)` | `lead-` | `:410,511,590` |
| `src/lib/sales-db.ts:123` | `genUuid()` (bare, no prefix) | — | `:270` (lead_vehicles.id), `:322` (repair_orders.id via bridge) |
| `src/lib/rental-db.ts:56` | `genFleetId()` | `FL-` | `:171` |
| `src/lib/comms-db.ts:43` | `genId()` | `comm-` | `:157` |
| `src/lib/parts-db.ts:45` | `genId()` | `part-` | `:185` |
| `src/lib/labor-db.ts:50` | `genId()` | `labor-` | `:197` |
| `src/lib/invoice-db.ts:40` | `genId()` | `inv-` | `:127` |
| `src/lib/commission-db.ts:26` | `genId(prefix)` | `cov-` | `:172` |
| `src/lib/procurement-db.ts:30` | `genId(prefix)` | `po-`, `poi-` | `:253,261` |
| `src/lib/assignments-db.ts:37` | `genId()` | `assign-` | `:144` |
| `src/lib/pdr-matrix-parser.ts:46` | `genId()` | `pdr-` | `:73` |
| `src/lib/supplement-db.ts:~72` | `genId(prefix)` | varies | `:205` (aging calc consumer, not id-gen call site) |
| `src/lib/remote-aob-db.ts:59` | `genToken()` (hex, no prefix) | — | `:75` |
| `src/lib/audit/ledger.ts:22` | `genId()` | `audit-` | `:108` |
| `src/app/api/v1/shop/config/route.ts:28` | `genId(prefix)` | `staff-`, `pdr-` | `:41,57` |
| `src/components/ops/SupplementsPanel.tsx:32` | `genId(prefix)` | `sli-`, `sup-` | `:127,154` |
| `src/components/onboarding/ShopIntakeForm.tsx:20` | `genId(prefix)` | `staff-`, `pdr-` | `:27,34,147` |
| `src/app/dashboard/ops/page.tsx:334` | inline (no shared helper) | `manual-` | same line |
| `src/components/ops/RODetailDrawer.tsx:510` | inline (no shared helper) | `pdr-` | same line |

This is **15 independent copies of the same ~5-line function**, one per DAL file, rather than one shared utility — not a naming violation under the audit's stated rules, but directly relevant to "every place an ID is generated client-side" and worth flagging as a maintenance/consistency risk: a fix to the `crypto` fallback logic (e.g. the non-UUID-shaped `Date.now()` fallback, which would fail a `uuid`-typed column's format check if ever hit) would need to be applied in 15 places.

---

## 3. STATUS VALUE CENSUS

Zod is not used anywhere in this repo (not in `package.json`, no imports found) — that request criterion yields zero results.

Given the volume (20+ distinct enum-like vocabularies), literals are grouped by concept rather than as one flat table; every literal is still individually cited.

### Core stage/status enums (DB-backed, native Postgres `enum` types)

| Concept | Values | DB citation | TS mirror citation |
|---|---|---|---|
| `ro_stage` | `INTAKE, TEARDOWN, HOLD_CARRIER, PDR_REPAIR, HOLD_PARTS, ADAS_SUBLET, HOLD_TOTAL_LOSS, QC_DELIVERY` | `supabase/migrations/20260101000000_init_mesh.sql:44-53` | `src/lib/database.types.ts:26-34` (`RoStage`), `src/lib/board.ts:11-20` (`STAGE_ORDER`) |
| `hold_gate_type` | `CARRIER_SUPPLEMENT, PARTS_BACKORDER, TOTAL_LOSS_REBUTTAL` | `:55-59` | `src/lib/database.types.ts:36-39`, `src/lib/board.ts:39,46,53` |
| `payout_status` | `PENDING, PROCESSING, PAID, FAILED, REVERSED` | `:61-67` | `src/lib/database.types.ts:41-46` |
| `payout_split_role` | `PDR_LEAD, SALES, HOUSE` | `:70-74` | `src/lib/database.types.ts:48` |
| `user_role` | `TECH, MANAGER, ADJUSTER, CUSTOMER, EXECUTIVE` | `:40-42` | `src/lib/database.types.ts:24` |
| `staff_role` | `SALES, ESTIMATOR, BODY_TECH, PAINTER, FOREMAN` | `supabase/migrations/20260727000000_order_assignments.sql:18-23` | `src/components/ops/types.ts:93` |

### Text-column + CHECK-constraint enums (not native Postgres types)

| Concept | Values | DB citation | TS mirror |
|---|---|---|---|
| `intake_leads.status` (LeadStatus) | `NEW, CONTACTED, ESTIMATE_SENT, AOB_SIGNED, APPROVED, CONVERTED, LOST, LOST_TO_COMPETITOR, CANCELLED` | `20260726000000_intake_leads.sql:38-39` | `src/components/sales/types.ts:8-17` |
| `intake_leads.dispatch_status` | `DISPATCHED, EN_ROUTE, ON_SITE, COMPLETED` | `20260730010000_catastrophe_hub.sql:24` | `src/components/sales/types.ts:158` |
| `intake_leads.remote_aob_status` | `NOT_SENT, SENT, SIGNED` | `20260730020000_legal_carrier_shield.sql:15` | `src/components/sales/types.ts:118` |
| `remote_aob_links.status` | `PENDING, SIGNED, EXPIRED` | `20260730020000_legal_carrier_shield.sql:40` | `src/lib/remote-aob-db.ts:17` |
| `intake_leads.channel` | `DIGITAL_INBOUND, FIELD_DISPATCH` | `20260730010000_catastrophe_hub.sql:14` | `src/components/sales/types.ts:125` |
| `intake_leads.severity` (StormSeverity) | `MINOR, MODERATE, SEVERE, CATASTROPHIC` | `20260730010000_catastrophe_hub.sql:18` | `src/components/sales/types.ts:133` |
| `lead_vehicles.severity` | same 4 (reuses StormSeverity by design) | `20260801010000_lead_vehicles.sql:22` | same type |
| `intake_leads.routing_path` | `SHOP_DROPOFF, MOBILE_HOUSE_CALL` | `20260730010000_catastrophe_hub.sql:21` | `src/components/sales/types.ts:150` |
| `rental_vehicles.status` | `AVAILABLE, RESERVED, RENTED, MAINTENANCE` | `20260726000100_rental_vehicles.sql:22` (orig. 3 values) + `20260731000000_rental_reserved_status.sql:18` (adds RESERVED) | `src/components/sales/types.ts:203` |
| `customer_rentals.status` | `ACTIVE, EXTENDED, EXPIRED, RETURNED` | `20260728120000_fleet_and_rentals.sql:20` | `src/components/ops/FleetRentalTracker.tsx:16` (locally-scoped, also named `RentalStatus` — see §3 flags) |
| `rental_reimbursements.status` | `PENDING, PARTIAL, COLLECTED, DISPUTED` | `20260728120000_fleet_and_rentals.sql:32` | `src/components/ops/FleetRentalTracker.tsx:17` |
| `parts_line_items.status` (PartStatus, layer a) | `NEEDED, ORDERED, IN_TRANSIT, RECEIVED, DISCREPANCY` | `20260725000000_parts_line_items.sql:20` | `src/components/ops/types.ts:12-17` |
| `repair_order_parts.status` (PartStatus, layer b) | `NEEDED, ORDERED, SHIPPED, RECEIVED, RETURNED` | `20260727000200_repair_order_parts.sql:23` | `src/components/ops/ro-parts-types.ts:15` |
| `repair_order_supplements.status` | `DRAFT, SUBMITTED, APPROVED, DENIED` | `20260727000300_repair_order_supplements.sql:19` | — |
| `SupplementPackage.status` (TS-only) | `DRAFT, SUBMITTED, APPROVED, REJECTED` | — | `src/components/ops/types.ts:197` |
| `supplement_records.lifecycle_status` | `DRAFT, SUBMITTED, APPROVED_PENDING_PAYMENT, PAID` | `20260728000900_supplement_records.sql:28` | `src/components/supplements/types.ts:29-33` |
| `SupplementItemStatus` (TS-only, no located DB column) | `PENDING, APPROVED, DENIED, REVISED` | UNVERIFIED — no CHECK constraint found; likely embedded inside `supplement_records.items` jsonb, not a real column | `src/components/supplements/types.ts:16` |
| `repair_order_labor.status` | `PENDING, IN_PROGRESS, COMPLETED` | `20260727000400_repair_order_labor.sql:22` | `src/components/ops/ro-labor-types.ts:9` |
| `repair_order_invoices.status` | `DRAFT, SENT, PAID, VOID` | `20260727000500_repair_order_invoices.sql:18` | `src/components/ops/ro-invoice-types.ts:8` |
| `purchase_orders.status` | `DRAFT, SENT, RECEIVED` | `20260728000700_inventory.sql:53` | `src/components/inventory/procurement-types.ts:11` |
| `insurance_payments.stall_status` | `ACTIVE, PENDING_NUDGE, MANAGER_ESCALATED, SUPERVISOR_ESCALATED` (widened from `..., ESCALATED`) | `20260728080000_ops_and_insurance_cadence.sql:34` → `20260728090000_upgrade_stall_tiers.sql:19` | `src/app/api/v1/insurance/cadence-check/route.ts:18-19`, `src/components/ops/OpsTimelineDispatch.tsx:11-15` |
| `subcontractor_milestones.status` | `PENDING, APPROVED, RELEASED, CANCELLED` | `20260728006000_subcontractor_milestones.sql:19` | — |
| `repair_orders.financial_status` | `open, closed_paid` (**lowercase — see flags**) | `20260728001000_repair_order_closeout.sql:14` | `src/app/api/v1/repair-orders/[repairOrderId]/close/route.ts:13,75,170,176` |
| `intake_leads.damage_type` (DamageType) | `Collision, Hail, Dent, Glass` (**Title-Case, no CHECK — see flags**) | plain text, `20260801000000_quick_lead_capture.sql:13` | `src/components/sales/types.ts:95` |

### TS-only vocabularies with no DB backing at all

| Type | Values | Citation | Note |
|---|---|---|---|
| `HoldCategory` | `Parts, Insurance, Tech, Sublet, Total Loss` | `src/components/ops/types.ts:132` | Ops/audit-view grouping over `hold_gate_type`; not persisted |
| `ROStatus` | `INTAKE, DIAGNOSIS, APPROVAL, IN_PROGRESS, QUALITY_CONTROL, READY, DELIVERED` | `src/components/ops/workflow-rules-types.ts:8-15` | Workflow-gate concept, separate from `ro_stage` |
| `RepairOrderStatus` | `INTAKE, TEARDOWN, SUPPLEMENT, REPAIR, QC, DELIVERED, WARRANTY_HOLD, CLOSED_AUDITING, PAYROLL_READY` | `src/types/index.ts:101-110` | File's own comment: "not yet wired to the DB or board" — a third, independent lifecycle vocabulary, exported from the central type barrel alongside the two that ARE wired |
| `TransactionStatus` | `COMPLETED, PARTIAL, PENDING, FAILED` | `src/app/api/v1/payments/verify/route.ts:68` | Computed API-response field, not a column |
| `STAFF_ROLES` (free text) | `TECH, PDR_TECH, ESTIMATOR, SALES, MANAGER, ADJUSTER, EXECUTIVE` | `src/components/onboarding/types.ts:52-60` | A third role vocabulary (7 values), overlaps but doesn't match `user_role` or `staff_role`; not DB-enum-backed |
| `HailSeverity` | `NONE, LIGHT, MODERATE, SEVERE` | `src/components/sales/types.ts:263` | Panel-by-panel walkaround assessment; stored as JSON inside `documents`/`walkaround_notes`, no CHECK found |

### Flag A — literals containing a space or hyphen

Raw enum **values** (not display labels) with whitespace:
- `'Total Loss'`, `'Parts'`, `'Insurance'`, `'Tech'`, `'Sublet'` — `HoldCategory`, `src/components/ops/types.ts:132` (space in `'Total Loss'` specifically; the others are single words but Title-Case, see Flag B.5).

Display-label strings (not enum values, but the literal customer-facing text, worth listing since typos here are invisible to type-checking):
- `'Lost — Competitor'` — `src/components/sales/types.ts:195` (em dash)
- `'Hold · Carrier'`, `'Hold · Parts'`, `'Hold · Total Loss'` — `src/lib/board.ts:37,44,51` (middle dot)
- `'Agreement Signed / AOB Executed'`, `'Triage & Routing'` — `src/app/dashboard/sales/page.tsx:57-58`
- `'Approved · Pending Payment'` — `src/components/supplements/types.ts:85`
- `'Mobile House Call'`, `'Shop Drop-off + Fleet Reservation'` — `src/components/sales/types.ts:153-154`
- `'Hail / Storm'`, `'Minor Dent / Scratch'`, `'Windshield / Glass'` — `src/components/sales/types.ts:99-101`
- `'Carrier Confirmed'`, `'Parts Arrived'`, `'Customer Approved'`, `'Custom Note'` — `src/components/ops/UnlockGateModal.tsx:17-21`

### Flag B — same concept spelled/valued differently across files

1. **`PartStatus` — same type name, two disjoint value sets** depending on which of two tables it backs: `parts_line_items` (`NEEDED, ORDERED, IN_TRANSIT, RECEIVED, DISCREPANCY`, `src/components/ops/types.ts:12-17`) vs `repair_order_parts` (`NEEDED, ORDERED, SHIPPED, RECEIVED, RETURNED`, `src/components/ops/ro-parts-types.ts:15`). A reader going by type name alone gets the wrong set.
2. **`RentalStatus` — same type name, two unrelated domains**: loaner fleet (`AVAILABLE, RESERVED, RENTED, MAINTENANCE`, `src/components/sales/types.ts:203`) vs external customer rental (`ACTIVE, EXTENDED, EXPIRED, RETURNED`, `src/components/ops/FleetRentalTracker.tsx:16`).
3. **`DENIED` vs `REJECTED` — real defect risk, not just naming.** DB CHECK on `repair_order_supplements.status` allows `'DENIED'` (`supabase/migrations/20260727000300_repair_order_supplements.sql:19`); TS `SupplementPackage.status` and its tone map use `'REJECTED'` instead (`src/components/ops/types.ts:197`, `src/components/ops/SupplementsPanel.tsx:27`). If the UI ever persists `'REJECTED'`, it will violate the DB constraint.
4. **`StallStatus` 3-value vs 4-value drift** — superseded but the 3-value form (`ACTIVE, PENDING_NUDGE, ESCALATED`) remains in `20260728080000_ops_and_insurance_cadence.sql:34` as dead history; current code correctly uses the replacement 4-value form throughout.
5. **Casing outlier: `DamageType` and `HoldCategory`** use Title-Case (`'Hail'`, `'Collision'`, `'Total Loss'`) while every other status/stage vocabulary in the codebase is `UPPER_SNAKE_CASE`. Both are also the only two with no backing DB CHECK constraint.
6. **`financial_status`** (`'open'`, `'closed_paid'`) is the only lowercase-with-underscore status literal in the entire schema; every sibling status column is UPPER_SNAKE.
7. **Role vocabulary sprawl**: `user_role` (5 values), `staff_role` (5 values), and free-text `STAFF_ROLES` (7 values, `src/components/onboarding/types.ts:52-60`) overlap but don't match.
8. **Non-canonical stage aliases**: `'PAINT'` and `'REASSEMBLY'` (`src/lib/stage-gates.ts:25-26,38`) are accepted by a gating function's `Set<string>` check but are members of neither the `ro_stage` DB enum nor `STAGE_ORDER`/`STAGE_META` — the function's `targetStage` param is typed as plain `string`, not `RoStage`, so nothing catches this at compile time.
9. **High-frequency word reuse across unrelated domains** (informational, not necessarily a defect): `PENDING` appears in 7+ distinct status types; `COMPLETED` in 3 (`DispatchStatus`, `LaborStatus`, `TransactionStatus`); `PARTIAL` in 2 with different companion sets each time.

---

## 4. VEHICLE FIELD DRIFT

**Column-name comparison — no prefix drift found.** Both `intake_leads` and `lead_vehicles` use the identical bare names `vehicle_year`, `vehicle_make`, `vehicle_model`, `vin` (`supabase/migrations/20260726000000_intake_leads.sql:26-30` vs `supabase/migrations/20260801010000_lead_vehicles.sql:18-21`). This was a deliberate design choice stated in the `lead_vehicles` migration's own comment (`:5`: "1:1 with its existing singular vehicle_year/vehicle_make/vehicle_model/vin"). No `vehicle_vin`-style inconsistency exists between the two tables.

**`damage_type`** — read/written only on `intake_leads`, never on `lead_vehicles` (the child table has no `damage_type` column at all — damage type is lead-level, not per-vehicle):
- Type: `src/components/sales/types.ts:69` (`IntakeLead.damageType`)
- DAL row type + mapping: `src/lib/sales-db.ts:69` (LeadRow), `:105` (rowToLead read)
- Write path (only writer): `src/lib/sales-db.ts:579` (QuickLeadInput), `:610` (assigned into lead object), `:628` (insert payload)
- UI: `src/components/sales/QuickLeadModal.tsx:51,77,191` — the only form that captures it

**`severity`** — read/written on **both** tables, intentionally sharing one vocabulary (`StormSeverity`):
- `intake_leads.severity` — lead-level "instant triage" rating. Type `src/components/sales/types.ts:47-48`; DAL `src/lib/sales-db.ts:59,95`; write path `src/lib/sales-db.ts:494,529,557` (`DigitalIntakeQuickAdd` flow); UI `src/components/sales/DigitalIntakeQuickAdd.tsx:75,179,294,303`.
- `lead_vehicles.severity` — per-vehicle rating. Type `src/components/sales/types.ts:87` (`LeadVehicle.severity`); DAL `src/lib/sales-db.ts:177,187` (LeadVehicleRow), `:238,259` (AddLeadVehicleInput, write); UI `src/components/sales/QuickLeadModal.tsx:32,90,267,269`.
- These are genuinely two different measurements at two different granularities (lead-wide vs. per-vehicle), not a drifted duplicate — but they share exactly one enum definition (`StormSeverity`, `src/components/sales/types.ts:133`), confirmed by the `lead_vehicles` migration's own comment (`20260801010000_lead_vehicles.sql:11-12`: "severity reuses the same vocabulary as intake_leads.severity ... one severity concept, not two").
- Note: this is unrelated to `HailSeverity` (`NONE/LIGHT/MODERATE/SEVERE`, panel-level walkaround assessment, `src/components/sales/types.ts:263`) or the PDR-vision "severity" (`LOW/MEDIUM/HIGH/REPLACE`, `src/lib/vision/client.ts:181,187,223`) — three unrelated fields share the English word "severity" with three different value sets. See §3 Flag B.9.

**Empirically: where does vehicle data land on lead creation?** Traced all three lead-creation entry points in `src/lib/sales-db.ts`:

| Creator | Called from | Writes to `intake_leads` (parent, single vehicle) | Writes to `lead_vehicles` (child, extra vehicles) |
|---|---|---|---|
| `saveIntakePackage` (`sales-db.ts:408`) | `src/components/sales/MobileIntakeWizard.tsx:393` | yes — always | **never** — no code path in this function or its caller touches `lead_vehicles` |
| `createDigitalLead` (`sales-db.ts:509`) | `src/components/sales/DigitalIntakeQuickAdd.tsx:167` | yes — always | **never** |
| `createQuickLead` (`sales-db.ts:588`) | `src/components/sales/QuickLeadModal.tsx:72` | yes — always (the single `vehicleMake` field only) | conditionally — the caller loops over its own `extraVehicles` draft rows and calls `addLeadVehicle(lead.id, ...)` once per row (`QuickLeadModal.tsx:85`), **after** `createQuickLead` has already returned |

**Conclusion**: `lead_vehicles` is written from exactly one UI path (`QuickLeadModal`) and only for vehicles beyond the first. `MobileIntakeWizard` and `DigitalIntakeQuickAdd` have no multi-vehicle capability at all — a lead captured through either of those two forms can never end up with `additionalVehicles`, regardless of how many vehicles the household actually has. This is a real, current functional gap, not a naming issue, but it directly answers the "does vehicle data land on the parent, the child, or both" question: **both, but only via `QuickLeadModal`; the other two intake paths write only the parent.**

---

## 5. DAL FALLBACK MAP

**Overarching finding: every fallback is an in-memory, module-level JS variable — never `localStorage`/`sessionStorage`.** Confirmed by grep across all of `src/`: the only `localStorage` references in the entire codebase are an unrelated comment about Supabase's own auth storage (`src/app/page.tsx:5`) and `src/lib/supabase.ts:31-32`'s explicit statement that the browser client persists its session via **cookies**, not localStorage. Every DAL fallback store below is a plain array/Map/object that exists only for the lifetime of the current module instance — lost on page reload, not shared across tabs, not guaranteed to survive across server invocations.

**No replay/flush/reconcile-on-reconnect logic exists anywhere in the repo.** Grepped broadly for `replay|flush|reconcile|resync|retry-queue|outbox|pending-writes`. The only hits are unrelated: "reconciled" in `CloseoutModal.tsx`/`close/route.ts` means a financial reconciliation gate (all parts RECEIVED before close), not a write-replay mechanism; `dashboard/error.tsx:31`'s "Re-Sync Dashboard" is a React error-boundary reset, not a queued-write flush; `stripe.ts:113`'s "Reconcile rounding" is a cents-remainder assignment. **Once a write falls back to memory, it is never automatically retried against Supabase.**

### Write-capable functions, by file

**`src/lib/assignments-db.ts`** (table `order_assignments`) — fallback store: `localAssignments` (Map, `:47`)
- `assignStaff` def `:117`, write `:126-135` (insert). Fallback: yes.
- `removeAssignment` def `:158`, write `:161` (delete). Fallback: yes, unconditional prune (`:165-168`).

**`src/lib/labor-db.ts`** (table `repair_order_labor`) — fallback store: `localLabor` (Map, `:60`)
- `addLaborEntry` def `:168`, write `:177-188` (insert). Fallback: yes.
- `toggleClock` def `:225`, write `:254-258` (update). Fallback: yes, via `findLocalEntry` (`:212`).
- `updateActualHours` def `:280`, write `:283-287` (update). Fallback: yes.
- `removeLaborEntry` def `:297`, write `:300` (delete). Fallback: yes, unconditional prune (`:304-307`).

**`src/lib/commission-db.ts`** (table `commission_overrides`) — fallback store: `localOverrides` (array, `:85`)
- `setCommissionOverride` def `:147`, write `:159-165` (insert). Fallback: yes (`:171`). Doc comment `:15-17`: this DAL is explicitly a reporting/override view that never mutates `payout_splits` itself.

**`src/lib/comms-db.ts`** (table `repair_order_comms`) — fallback store: `localComms` (Map, `:53`)
- `addCommEntry` def `:130`, write `:137-148` (insert). Fallback: yes.

**`src/lib/parts-db.ts`** (table `repair_order_parts`) — fallback store: `localParts` (Map, `:55`)
- `addPart` def `:152`, write `:163-176` (insert). Fallback: yes.
- `updatePartStatus` def `:203`, write `:206-210` (update). Fallback: yes.
- `removePart` def `:225`, write `:228` (delete). Fallback: yes, unconditional prune (`:232-235`).

**`src/lib/invoice-db.ts`** (table `repair_order_invoices`) — fallback store: `localInvoices` (Map, `:53`)
- `generateInvoice` def `:97`, write `:107-118` (insert). Fallback: yes.
- `updateInvoiceStatus` def `:141`, write `:151-155` (update). Fallback: yes.

**`src/lib/remote-aob-db.ts`** (table `remote_aob_links`) — fallback store: `localLinks` (Map, `:68`)
- `createRemoteAobLink` def `:71`, write `:80-88` (insert). Fallback: yes.
- `signRemoteAobLink` def `:128`, write `:136-139` (update). Fallback: yes.
- Flagged risk: this DAL is used from both browser and server API route contexts (file comment `:8-10`) — the fallback store can independently exist as two disconnected in-memory copies; a link created in one process's fallback is invisible to a signing request served by a different process.

**`src/lib/ops-data.ts`** (tables `repair_orders`, `vehicles`, `hold_gate_logs`) — **no in-function fallback anywhere**; file comment `:128-134` states this DAL is "real-DB only."
- `persistStage` def `:105`, write `:111-114` (update). Fallback: no — caller (`src/app/dashboard/ops/page.tsx:242,244`) reverts optimistic React state on error; nothing persisted.
- `createManualIntake` def `:135`, writes `:141-143` (vehicles insert), `:150-159` (repair_orders insert). Fallback: no in this file — caller falls back to pushing onto module-level `MOCK_BOARD_ORDERS` (`src/lib/ops-mock.ts:17`) at `page.tsx:350`.
- `persistRepairOrder` def `:171`, write `:182-185` (update). Fallback: no — same optimistic-then-revert pattern.
- `persistUnlock` def `:200`, writes `:206-209` (repair_orders, errors surfaced) and `:212-216` (hold_gate_logs audit trail, errors deliberately swallowed per doc comment `:190-198` — an unlock already performed must not roll back for a failed audit write). Fallback: no persisted fallback either way; the audit-log entry on failure is simply lost.

**`src/lib/ops-db.ts`**
- `importEstimateLineItems` (table `parts_line_items`) def `:107`, write `:130` (insert+select). Fallback: partial — on failure returns synthetic records with id `local-<claim>-<seq>` (`:125-126`, counter `localSeq` at `:95`) for immediate render, but these are **not stored in any array for later retry**.
- `updatePartStatus` (table `parts_line_items`) def `:143`, write `:151` (update). Fallback: no — only `console.warn`'d (`:153,156`); doc comment `:138-141` says the caller's existing optimistic state stands uncorrected.
- `markPartReceived` def `:168`, write `:173-185` (update). Fallback: no — error returned to caller.
- `flagPartDiscrepancy` def `:261`, write `:266-275` (update). Fallback: no.
- `saveSupplementPackage` (table `supplement_packages`) def `:350`, write `:353-361` (upsert). Fallback: yes — `localSupplements` (Record, `:313`, seeded from `MOCK_SUPPLEMENTS`).

**`src/lib/supplement-db.ts`** (table `supplement_records`) — fallback store: `localRecords` (array, `:90`)
- `saveSupplement` def `:153`, write `:157` (upsert). Fallback: yes.
- `deleteSupplement` def `:170`, write `:173` (delete). Fallback: yes.
- `updateSupplementStatus` def `:184`, write `:190-192` (update). Fallback: yes.

**`src/lib/sales-db.ts`** (tables `intake_leads`, `lead_vehicles`, `vehicles`, `repair_orders`) — largest DAL
- `addLeadVehicle` (table `lead_vehicles`) def `:245`, write `:251-260` (insert). Fallback: yes — `localLeadVehicles` (Map, `:193`).
- `saveIntakePackage` (table `intake_leads`) def `:408`, write `:440-465` (insert). Fallback: yes, and **unconditional** — `localLeads` (array, `:136`) is pushed at `:473` regardless of whether the DB insert already succeeded (a dual-write, not a pure fallback). Also writes `intakePackages` (Record, `:278`) at `:474`.
- `createDigitalLead` def `:509`, write `:538-562`. Fallback: yes, unconditional mirror to `localLeads` (`:570`).
- `createQuickLead` def `:588`, write `:615-629`. Fallback: yes, unconditional mirror (`:637`).
- `updateLeadStatus` def `:651`, write `:654-658` (update). Fallback: yes, unconditional mirror (`:663-668`).
- `assignLeadStaff` def `:678`, write `:686-690` (update). Fallback: yes — `localLeads`.
- `updateLeadRouting` def `:710`, write `:721-729` (update). Fallback: yes — `localLeads`.
- `dispatchLead` def `:751` — delegates the write to Server Action `dispatchMobileUnit` (`src/app/actions/dispatch.ts:35`, write `:42-49`). Fallback: yes, on `result.success === false` mutates `localLeads` (`sales-db.ts:756-762`).
- `updateDispatchStatus` def `:767` — delegates to `advanceDispatchStatus` (`src/app/actions/dispatch.ts:58`, write `:63-66`). Fallback: yes, same pattern (`sales-db.ts:769-774`).
- `markRemoteAobDispatched` def `:781`, write `:784-787` (update). Fallback: yes, unconditional mirror (`:791-796`).
- `bridgeIntakeToOps` (internal) def `:313` — delegates the `repair_orders` write to Server Action `bridgeRepairOrder` (`src/app/actions/intake-bridge.ts:32`, write `:40-46`). Fallback: yes, **and unconditional regardless of the server-action outcome** — always pushes a synthesized order onto shared `MOCK_BOARD_ORDERS` (`src/lib/ops-mock.ts:17`) at `sales-db.ts:355-376`, meaning the shop-floor board reads from the in-memory array even when the real DB row also exists (a dual-write/possible-divergence risk).
- `convertLeadToRO` def `:833`, writes `:892-900` (vehicles insert), `:906-917` (repair_orders insert), `:923-926` (intake_leads status update, best-effort/non-fatal per `:928` warning). Fallback: yes, on any exception falls through to `bridgeIntakeToOps` (line 960) plus mutates `leadRoMap` (Map, `:282`) and `localLeads` status (`:948-949,958-959`).
- `resurrectAndConvertLead` def `:975` — no direct write; wraps `convertLeadToRO`, inherits its fallbacks transitively.

**`src/lib/procurement-db.ts`** (tables `purchase_orders`, `purchase_order_items`) — fallback store: `localPOs` (array, `:39`, pre-seeded with one demo PO)
- `generatePurchaseOrder` def `:176`, writes `:203-207`, `:223-226` (two inserts). Fallback: yes, pushed at `:268` only when the DB path produced no `po` object (a real fallback, not dual-write).
- `updatePurchaseOrderStatus` def `:276`, write `:282-286` (update). Fallback: yes.

**`src/lib/rental-db.ts`** (table `rental_vehicles`) — fallback store: `fleet` (array, `:18`)
- `assignVehicle` def `:103`, write `:116-129` (update). Fallback: yes, via `patchLocal()` (`:87`).
- `reserveVehicle` def `:145` — delegates to Server Action `reserveVehicleForLead` (`src/app/actions/fleet-reservation.ts:31`, write `:36-44`). Fallback: yes, on failure `patchLocal()` (`rental-db.ts:153-157`).
- `addVehicle` def `:169`, write `:185-192` (insert). Fallback: yes, pushed at `:198`.
- `removeVehicle` def `:203`, write `:206-210` (delete). Fallback: yes, spliced at `:217`.
- `returnVehicle` def `:226`, write `:239-252` (update). Fallback: yes, via `patchLocal`.
- `setVehicleStatus` def `:261`, write `:264-268` (update). Fallback: yes, via `patchLocal`.

**Server Actions — no fallback at this layer** (fallback lives one layer up, in the DAL function that calls them):
- `src/app/actions/dispatch.ts` — `dispatchMobileUnit` (`:35`, write `:42-49`), `advanceDispatchStatus` (`:58`, write `:63-66`). Both return `{success:false,error}`; no local store here.
- `src/app/actions/fleet-reservation.ts` — `reserveVehicleForLead` (`:31`, write `:36-44`). Same pattern.
- `src/app/actions/intake-bridge.ts` — `bridgeRepairOrder` (`:32`, write `:40-46`). Same pattern.

### Fallback store inventory (all in-memory; none in Web Storage)

| Store | Type | Declared |
|---|---|---|
| `localAssignments` | `Map<string, OrderAssignment[]>` | `src/lib/assignments-db.ts:47` |
| `localLabor` | `Map<string, RepairOrderLaborEntry[]>` | `src/lib/labor-db.ts:60` |
| `localOverrides` | `CommissionOverrideRow[]` | `src/lib/commission-db.ts:85` |
| `localComms` | `Map<string, RepairOrderCommEntry[]>` | `src/lib/comms-db.ts:53` |
| `localParts` | `Map<string, RepairOrderPart[]>` | `src/lib/parts-db.ts:55` |
| `localInvoices` | `Map<string, RepairOrderInvoice>` | `src/lib/invoice-db.ts:53` |
| `localLinks` | `Map<string, RemoteAobLinkRecord>` | `src/lib/remote-aob-db.ts:68` |
| `localSupplements` | `Record<string, SupplementPackage[]>` | `src/lib/ops-db.ts:313` |
| `localRecords` | `SupplementRecord[]` | `src/lib/supplement-db.ts:90` |
| `localLeads` | `IntakeLead[]` | `src/lib/sales-db.ts:136` |
| `localLeadVehicles` | `Map<string, LeadVehicle[]>` | `src/lib/sales-db.ts:193` |
| `intakePackages` | `Record<string, IntakeSubmission>` | `src/lib/sales-db.ts:278` |
| `leadRoMap` | `Map<string, string>` | `src/lib/sales-db.ts:282` |
| `localPOs` | `ProcurementPO[]` | `src/lib/procurement-db.ts:39` |
| `fleet` | `RentalVehicle[]` | `src/lib/rental-db.ts:18` |
| `MOCK_BOARD_ORDERS` (shared, mutated in place) | `BoardOrder[]` | `src/lib/ops-mock.ts:17` |

---

## 6. NAMING VIOLATIONS

Convention checked against: tables snake_case plural; child tables `<parent_singular>_<thing>`; columns snake_case; enums UPPER_SNAKE with no spaces/hyphens; booleans `is_`/`has_`; timestamps `_at`; FKs `<table_singular>_id`. **This convention conflicts with CLAUDE.md's own documented schema spec in several places — see §7 before treating any of these as a simple fix.**

### FK naming — three competing patterns for "which repair order does this belong to"

| current | proposed | blast radius |
|---|---|---|
| `ro_id` (uuid, **with** FK constraint) — `total_loss_audits`, `hold_gate_logs`, `proof_of_payments`, `payout_splits` (`supabase/migrations/20260101000000_init_mesh.sql:144,158,174,187`) | `repair_order_id` | 12 files reference the bare token `ro_id` (`grep -rlw ro_id src supabase/migrations`) |
| `repair_order_id` (uuid, with FK) — `order_assignments`, `repair_order_parts/supplements/labor/invoices/comms`, `insurance_payments`, `subcontractor_milestones`, `ops_timelines`, `customer_rentals`, `rental_reimbursements`, `purchase_orders` | *(already compliant — this is the majority pattern)* | 26 files already use this spelling |
| `ro_id` (**text, no FK constraint**) — `supplement_records` (`20260728000900_supplement_records.sql:22`), `commission_overrides` (`20260730010000_catastrophe_hub.sql:47`) | `repair_order_id uuid references repair_orders(id)`, but this would break the documented intent of accepting non-DB ids (see §7) | subset of the 12 `ro_id` hits above |
| `assigned_ro_id` (text, no FK) — `rental_vehicles` (`20260726000100_rental_vehicles.sql:26`), and **actually stores `intake_leads.id` values, not repair-order ids** | `assigned_lead_id`, matching what it actually holds | 3 files reference `assigned_ro_id` |

This is a genuine, multi-file inconsistency independent of the CLAUDE.md tension noted in §7 — `repair_order_id` is already the dominant, FK-enforced spelling; `ro_id`-as-text-with-no-FK is the outlier that carries real data-integrity risk (nothing stops an invalid reference from being stored).

### Child-table prefix pattern (`<parent_singular>_<thing>`)

Compliant: `repair_order_comms/invoices/labor/parts/supplements`, `purchase_order_items` (parent `purchase_orders` → singular `purchase_order`).

Non-compliant (table doesn't carry its parent's name at all, only an internal FK column does): `hold_gate_logs`, `total_loss_audits`, `proof_of_payments`, `payout_splits`, `order_assignments` (says "order" not "repair_order"), `customer_rentals`, `rental_reimbursements`, `commission_overrides`, `subcontractor_milestones`, `ops_timelines`, `remote_aob_links`, **`lead_vehicles`** (parent `intake_leads` → strict convention would be `intake_lead_vehicles`).

Blast radius for renaming any of these is large by construction (every DAL file, every migration, every TS type referencing the table name) — not individually counted here since §7 explains why renaming most of them would contradict the project's own documented spec.

### Boolean columns not `is_`/`has_` prefixed

| current | proposed | blast radius (files referencing the bare column name) |
|---|---|---|
| `agreement_accepted` (intake_leads) | `has_agreement_accepted` or `is_agreement_accepted` | 2 |
| `hold_gate_active` (repair_orders) | `is_hold_gate_active` | 12 |
| `ocr_verified_flag` (proof_of_payments) | `is_ocr_verified` (also drop the redundant `_flag` suffix) | 4 |
| `policyholder_match` (intake_leads) | `is_policyholder_match` or `has_policyholder_match` | 2 |
| `setup_completed` (organizations) | `is_setup_completed` | 6 |
| `capa_certified` (parts_line_items) | `is_capa_certified` | 2 |
| `preferred` (dropped `suppliers` table — historical only, no live blast radius) | `is_preferred` | 0 (table no longer exists) |

7 of 7 boolean columns in the schema violate the `is_`/`has_` convention; none currently follow it.

### Timestamp columns not `_at`-suffixed (or not even a timestamp type)

| current | type | proposed |
|---|---|---|
| `rental_expiry_date` (customer_rentals) | `date` | `rental_expiry_at` (and reconsider whether `date` vs `timestamptz` is intentional — it's the only bare `date` column in the schema) |
| `target_delivery_date` (repair_orders) | `timestamptz` | `target_delivery_at` |
| `expected_return_date` (rental_vehicles) | **text** | `expected_return_at timestamptz` — currently not even a real date/time type |
| `replacement_expected_date` (parts_line_items) | **text** | `replacement_expected_at timestamptz` — same issue |

### Enum value casing

- `DamageType` (`Collision, Hail, Dent, Glass`) and `HoldCategory` (`Parts, Insurance, Tech, Sublet, Total Loss`) are Title-Case; every other enum in the schema is UPPER_SNAKE. `damage_type` has no CHECK constraint at all (plain text), so nothing currently enforces even this Title-Case convention at the DB layer.
- `financial_status` (`open`, `closed_paid`) is lowercase-with-underscore, the only such case in the schema.

### Schema qualification

- `insurance_payments` is the only table created without an explicit `public.` prefix (`create table if not exists insurance_payments`, `supabase/migrations/20260728002000_insurance_payments.sql:1`, vs. `create table if not exists public.<name>` everywhere else). Functionally harmless (public is the default search_path) but stylistically inconsistent.

### Type-name collisions (TS, not DB, but naming-adjacent and high-risk)

- `PartStatus` declared twice with different value sets (`src/components/ops/types.ts:12-17` vs `src/components/ops/ro-parts-types.ts:15`).
- `RentalStatus` declared twice with different value sets (`src/components/sales/types.ts:203` vs `src/components/ops/FleetRentalTracker.tsx:16`, the latter file-local but same name).

---

## 7. OPEN QUESTIONS

1. **The audit's requested FK/table-naming convention directly contradicts CLAUDE.md's own documented schema spec.** CLAUDE.md (checked into the repo, "OVERRIDES any default behavior") explicitly specifies table names `total_loss_audits`, `hold_gate_logs`, `proof_of_payments`, `payout_splits` with a column literally named `ro_id` (not `repair_order_id`), and does not describe a `repair_order_`-prefixed child-table naming scheme at all. §6's `ro_id`→`repair_order_id` and "add parent prefix to child tables" proposals would put the schema in conflict with the project's own written spec for exactly the four core tables CLAUDE.md names outright. **Open question: does the naming convention this audit was asked to check against supersede CLAUDE.md, or does CLAUDE.md's explicit spec take precedence and the convention should be treated as aspirational-for-new-tables-only?** Not resolvable from the code alone.

2. **Is `ro_id`-as-text-with-no-FK (`supplement_records`, `commission_overrides`) a bug or intentional?** Both migrations carry explicit source comments stating this is deliberate, to accommodate non-DB/mock repair-order ids (e.g. `'mock-a6f1'`). If that's still true today, tightening these to a real `uuid` FK (per §6) would break that stated compatibility goal. If the mock/local-fallback board is being phased out, the comments are stale and the columns should be tightened. Cannot determine which from the code alone — this is a product/roadmap question.

3. **`rental_vehicles.assigned_ro_id` storing `intake_leads.id` values is either a bug or a naming lie.** Either the column should be renamed to reflect what it actually holds (`assigned_lead_id`), or the seed data / application code is wrong to put lead ids there and it should genuinely hold repair-order ids once a booking converts. The current code (verified this session, `RoutingActionPanel`/`ReserveVehicleModal` reservation flow) only ever has a lead id available at the point a vehicle is reserved — there is no repair-order-id source at that point in the flow — so the column may be structurally incapable of ever holding what its name promises.

4. **`DENIED` (DB) vs `REJECTED` (TS) on repair_order_supplements is the one finding in this audit that looks like a live correctness bug, not a style issue.** UNVERIFIED whether any code path actually attempts to persist `'REJECTED'` to this column (the census agent found the TS type and its tone map but did not trace every write call site for this specific table) — worth a targeted follow-up before treating it as confirmed-broken vs. simply unreachable dead code.

5. **`stage-gates.ts`'s `'PAINT'`/`'REASSEMBLY'` aliases** (§3 Flag B.8) — dead/vestigial from a planned but unshipped stage extension, or a live gap where the `ro_stage` enum should have 2 more values it doesn't? The function accepting them is typed loosely enough (`string`, not `RoStage`) that this wouldn't surface as a type error either way. UNVERIFIED which.

6. **`SupplementItemStatus`'s backing store is UNVERIFIED.** No migration defines a dedicated table or column with a CHECK constraint matching `PENDING/APPROVED/DENIED/REVISED`; it's presumably nested inside `supplement_records.items` (jsonb), but no code path confirming the exact JSON shape was traced as part of this audit. Flagged rather than asserted.

7. **`database.types.ts` staleness is a process question, not a code question.** It's missing at least 3 migrations' worth of schema (rental RESERVED status, address/damage_type, lead_vehicles). Is there a `supabase gen types` step that's supposed to run on merge and isn't, or is this file manually maintained and simply behind? Not answerable from the repository alone — flagged because every consumer of `database.types.ts` (grep shows it's imported for `RoStage`, `HoldGateType`, `UserRole`, `PayoutStatus`, `PayoutSplitRole` types) is trusting a file that's demonstrably out of sync with the tables those very consumers read and write.

8. **No live database dump was reachable from this environment** (no `docker`, no direct Postgres connection string/password — only REST API keys in `.env.local`; `supabase db dump` requires Docker even for `--linked`/`--db-url` remote dumps and fails immediately with `LegacyDockerRunError` here). Section 1 is reconstructed entirely from static analysis of the 33 migration files in application order. This is very likely accurate (Postgres migrations are inherently sequential and each ALTER was traced against its base CREATE), but it is **not** independently cross-checked against the actual live schema state, and any out-of-band manual change ever made directly against the database (outside the migration files) would not be reflected here and would have no way to be detected by this method.
