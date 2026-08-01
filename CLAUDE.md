# MESH Platform Architecture & Agent Directive

## 1. Stack Specifications
- Framework: Next.js 15 (App Router, TypeScript, Tailwind CSS)
- Database & Auth: Supabase (PostgreSQL with RLS, Supabase Auth)
- AI Vision: Gemini 2.0 Flash (`@google/genai` SDK)
- Payments & Payouts: Stripe Connect Custom Accounts
- Drag & Drop: `@dnd-kit/core` / `@dnd-kit/sortable`

## 2. Multi-Tenant Database Schema Requirements
Database tables must include:
1. `organizations` (id, name, created_at)
2. `locations` (id, organization_id, name, address)
3. `users` (id, auth_user_id, organization_id, role: 'TECH'|'MANAGER'|'ADJUSTER'|'CUSTOMER'|'EXECUTIVE')
4. `vehicles` (id, vin, make, model, year, paint_code)
5. `repair_orders` (id, organization_id, location_id, vehicle_id, customer_name, claim_number, stage, hold_gate_active)
6. `total_loss_audits` (id, ro_id, acv_amount, conventional_estimate, pdr_estimate, risk_score, state_threshold_pct)
7. `hold_gate_logs` (id, ro_id, gate_type, locked_at, unlocked_at, resolved_by)
8. `proof_of_payments` (id, ro_id, check_amount, check_image_url, ocr_verified_flag)
9. `payout_splits` (id, ro_id, tech_user_id, gross_amount, tech_split_pct, net_payout, stripe_transfer_id, status)

### Enums
- `ro_stage`: 'INTAKE', 'TEARDOWN', 'HOLD_CARRIER', 'PDR_REPAIR', 'HOLD_PARTS', 'ADAS_SUBLET', 'HOLD_TOTAL_LOSS', 'QC_DELIVERY'
- `hold_gate_type`: 'CARRIER_SUPPLEMENT', 'PARTS_BACKORDER', 'TOTAL_LOSS_REBUTTAL'

## 3. Core Engine Business Rules

### A. Gemini 2.0 Flash PDR Vision Engine (`/api/v1/vision/pdr-analyze`)
- Accepts base64 reflection-grid PDR photos.
- Analyzes grid distortion lines to output JSON: `dent_count`, `density_category` ('LOW'|'MEDIUM'|'HIGH'), `panel_id`, `aluminum_flag`, `pdr_feasibility_score` (0.0 to 1.0).

### B. Total Loss ACV Rebuttal Math
- Calculates Risk Score: Risk = Conventional Cost / (ACV * Threshold %)
- Generates side-by-side PDR vs. Conventional Cut/Replace comparison object.

### C. 8-Stage Drag Board Hold Gates
- Stages `HOLD_CARRIER`, `HOLD_PARTS`, and `HOLD_TOTAL_LOSS` represent active Hold Gates.
- While a Hold Gate is active (`hold_gate_active = true`), the UI card must render an Amber/Red lock badge, and dnd-kit must prevent dragging out of the column until unlocked.

### D. Proof of Payment (PoP) & 1099 Split Ledger
- OCR extracts check amount and claim ID from check image upload.
- Upon PoP verification, executes Stripe Connect transfers: 50% PDR Lead Tech, 10% Sales, 40% House.

## 4. Coding & File Structure Conventions
- Keep API routes inside `app/api/v1/`
- Place core logic utilities under `src/lib/` (`supabase.ts`, `gemini.ts`, `stripe.ts`, `totalloss.ts`)
- Use Tailwind CSS with clean, high-contrast dark-mode friendly components.

## 5. Architecture Reference
- **`docs/SCHEMA_OVERVIEW.md`** — consolidated map of the DB schema (Supabase
  migrations + `src/lib/database.types.ts`), per-feature data-access modules,
  persistence/fallback layers, type files, API routes, and env vars. Start here.
- **`src/types/index.ts`** — central type barrel re-exporting every per-feature
  type (single import surface; types-only, safe on client or server).
- No Prisma/Drizzle and no central data store — data access is per-feature under
  `src/lib/`, each DB-first with a session/JSON fallback.

## 6. Naming Decisions (audit resolution)

1. `ro_id` is CORRECT and stays. RO is industry-standard shorthand, same
   class as `vin` and `rsa`. Do not rename to `repair_order_id`. This
   supersedes any generic `<table_singular>_id` convention.
2. Approved abbreviations: `vin`, `rsa`, `ro`. All other columns spell out.
3. `repair_order_supplements.status`: `DENIED` is canonical. RESOLVED — TS
   aligned to DB (types.ts, SupplementsPanel.tsx); no migration was required
   since the DB check constraint already accepted DENIED. Zero REJECTED
   occurrences remain.
4. `rental_vehicles.assigned_ro_id` stores `intake_leads.id` values, NOT
   repair order ids. Do not join it to `repair_orders`. Rename pending.
5. `intake_leads.id` is text, not uuid, and this is deliberate — local
   fallback IDs are not valid UUIDs. Do not "fix" it without a
   coordinated ID-generation migration.
6. `database.types.ts` is stale. Migrations are the source of truth.
   Regenerate with: `supabase gen types typescript --project-id <ref>`
