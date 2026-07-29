/**
 * MESH Platform — cloud seed (Admin API + domain upserts).
 *
 * `supabase db push` applies migrations but does NOT run supabase/seed.sql.
 * On a hosted project, creating users by inserting straight into auth.users is
 * fragile, so this script:
 *   1. Creates the 6 demo auth users via the Supabase Admin API (service role).
 *   2. Upserts the domain rows (orgs, locations, users, vehicles, repair
 *      orders, audit, gate logs, PoP, payout splits) with fixed UUIDs.
 *
 * Trigger-derived columns are intentionally omitted (hold_gate_active,
 * risk_score, net_payout, and RO-child organization_id) — the DB fills them.
 *
 * Idempotent: re-running re-uses existing auth users and upserts on id.
 *
 * Prereqs:
 *   - `npx supabase db push` has created the schema on the cloud project.
 *   - .env.local has NEXT_PUBLIC_SUPABASE_URL and a REAL SUPABASE_SERVICE_ROLE_KEY.
 *
 * Run:
 *   node --env-file=.env.local scripts/seed-cloud.mjs
 *   (or: npm run seed:cloud)
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE_KEY || SERVICE_KEY.includes('your_')) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or a real SUPABASE_SERVICE_ROLE_KEY in .env.local.',
  );
  console.error('Get the service_role key from Dashboard → Project Settings → API.');
  process.exit(1);
}

const supabase = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Public client used only to resolve an existing user's id via sign-in,
// because this project's Auth Admin `listUsers` endpoint returns 500.
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const anon = createClient(URL, ANON_KEY ?? SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = 'password123';
const ORG_A = '00000000-0000-0000-0000-00000000a001';
const ORG_B = '00000000-0000-0000-0000-00000000b001';

/* ---- Demo accounts (public.users.id is fixed; auth_user_id is created) --- */
const ACCOUNTS = [
  { id: '00000000-0000-0000-0000-00000000a1e1', email: 'executive@apex.com', role: 'EXECUTIVE', full_name: 'Erin Apex', organization_id: ORG_A },
  { id: '00000000-0000-0000-0000-00000000a1d1', email: 'manager@apex.com', role: 'MANAGER', full_name: 'Marcus Apex', organization_id: ORG_A },
  { id: '00000000-0000-0000-0000-00000000a1c1', email: 'tech@apex.com', role: 'TECH', full_name: 'Tara Tech', organization_id: ORG_A },
  { id: '00000000-0000-0000-0000-00000000a1b1', email: 'adjuster@apex.com', role: 'ADJUSTER', full_name: 'Aja Adjuster', organization_id: ORG_A },
  { id: '00000000-0000-0000-0000-00000000b1d1', email: 'manager@bridgeway.com', role: 'MANAGER', full_name: 'Bea Bridge', organization_id: ORG_B },
  { id: '00000000-0000-0000-0000-00000000b1c1', email: 'tech@bridgeway.com', role: 'TECH', full_name: 'Ben Bridge', organization_id: ORG_B },
];

const ORGANIZATIONS = [
  { id: ORG_A, name: 'Apex Collision' },
  { id: ORG_B, name: 'Bridgeway Auto Body' },
];

const LOCATIONS = [
  { id: '00000000-0000-0000-0000-00000000a101', organization_id: ORG_A, name: 'Apex — Downtown', address: '120 Main St, Denver, CO 80202' },
  { id: '00000000-0000-0000-0000-00000000a102', organization_id: ORG_A, name: 'Apex — Airport', address: '8800 Pena Blvd, Denver, CO 80249' },
  { id: '00000000-0000-0000-0000-00000000b101', organization_id: ORG_B, name: 'Bridgeway — Main', address: '45 River Rd, Austin, TX 78701' },
];

const VEHICLES = [
  { id: '00000000-0000-0000-0000-00000000a5f1', organization_id: ORG_A, vin: '1FTFW1E80MFA00001', make: 'Ford', model: 'F-150', year: 2021, paint_code: 'UM-Oxford White' },
  { id: '00000000-0000-0000-0000-00000000a5f2', organization_id: ORG_A, vin: '1HGCV1F30LA000002', make: 'Honda', model: 'Accord', year: 2020, paint_code: 'NH-731P Crystal Black' },
  { id: '00000000-0000-0000-0000-00000000a5f3', organization_id: ORG_A, vin: '5YJ3E1EA7KF000003', make: 'Tesla', model: 'Model 3', year: 2019, paint_code: 'PPSW Pearl White' },
  { id: '00000000-0000-0000-0000-00000000b5f1', organization_id: ORG_B, vin: '4T1B11HK5KU000004', make: 'Toyota', model: 'Camry', year: 2019, paint_code: '040 Super White' },
];

const REPAIR_ORDERS = [
  { id: '00000000-0000-0000-0000-00000000a6f1', organization_id: ORG_A, location_id: '00000000-0000-0000-0000-00000000a101', vehicle_id: '00000000-0000-0000-0000-00000000a5f1', customer_name: 'Dana Whitfield', claim_number: 'APX-2026-0001', stage: 'INTAKE' },
  { id: '00000000-0000-0000-0000-00000000a6f2', organization_id: ORG_A, location_id: '00000000-0000-0000-0000-00000000a101', vehicle_id: '00000000-0000-0000-0000-00000000a5f2', customer_name: 'Leo Marsh', claim_number: 'APX-2026-0002', stage: 'PDR_REPAIR' },
  { id: '00000000-0000-0000-0000-00000000a6f3', organization_id: ORG_A, location_id: '00000000-0000-0000-0000-00000000a102', vehicle_id: '00000000-0000-0000-0000-00000000a5f3', customer_name: 'Priya Nair', claim_number: 'APX-2026-0003', stage: 'HOLD_CARRIER' },
  { id: '00000000-0000-0000-0000-00000000a6f4', organization_id: ORG_A, location_id: '00000000-0000-0000-0000-00000000a102', vehicle_id: '00000000-0000-0000-0000-00000000a5f1', customer_name: 'Sam Okoye', claim_number: 'APX-2026-0004', stage: 'HOLD_TOTAL_LOSS' },
  { id: '00000000-0000-0000-0000-00000000a6f5', organization_id: ORG_A, location_id: '00000000-0000-0000-0000-00000000a101', vehicle_id: '00000000-0000-0000-0000-00000000a5f2', customer_name: 'Grace Lin', claim_number: 'APX-2026-0005', stage: 'QC_DELIVERY' },
  { id: '00000000-0000-0000-0000-00000000b6f1', organization_id: ORG_B, location_id: '00000000-0000-0000-0000-00000000b101', vehicle_id: '00000000-0000-0000-0000-00000000b5f1', customer_name: 'Hector Ruiz', claim_number: 'BRG-2026-0001', stage: 'HOLD_PARTS' },
];

const TOTAL_LOSS_AUDITS = [
  { id: '00000000-0000-0000-0000-00000000a7f1', ro_id: '00000000-0000-0000-0000-00000000a6f4', acv_amount: 18000.0, conventional_estimate: 15500.0, pdr_estimate: 4200.0, state_threshold_pct: 75.0 },
];

const DAY = 86400000;
const HOUR = 3600000;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const HOLD_GATE_LOGS = [
  { id: '00000000-0000-0000-0000-00000000a8f1', ro_id: '00000000-0000-0000-0000-00000000a6f3', gate_type: 'CARRIER_SUPPLEMENT', locked_at: iso(now - 2 * DAY), unlocked_at: null, resolved_by: null },
  { id: '00000000-0000-0000-0000-00000000a8f2', ro_id: '00000000-0000-0000-0000-00000000a6f4', gate_type: 'TOTAL_LOSS_REBUTTAL', locked_at: iso(now - 1 * DAY), unlocked_at: null, resolved_by: null },
  { id: '00000000-0000-0000-0000-00000000a8f3', ro_id: '00000000-0000-0000-0000-00000000a6f5', gate_type: 'PARTS_BACKORDER', locked_at: iso(now - 6 * DAY), unlocked_at: iso(now - 3 * DAY), resolved_by: '00000000-0000-0000-0000-00000000a1d1' },
  { id: '00000000-0000-0000-0000-00000000b8f1', ro_id: '00000000-0000-0000-0000-00000000b6f1', gate_type: 'PARTS_BACKORDER', locked_at: iso(now - 4 * HOUR), unlocked_at: null, resolved_by: null },
];

const PROOF_OF_PAYMENTS = [
  { id: '00000000-0000-0000-0000-00000000a9f1', ro_id: '00000000-0000-0000-0000-00000000a6f5', check_amount: 5000.0, check_image_url: 'https://storage.example.com/checks/APX-2026-0005.jpg', ocr_verified_flag: true },
];

const PAYOUT_SPLITS = [
  { id: '00000000-0000-0000-0000-0000000aa001', ro_id: '00000000-0000-0000-0000-00000000a6f5', tech_user_id: '00000000-0000-0000-0000-00000000a1c1', split_role: 'PDR_LEAD', gross_amount: 5000.0, tech_split_pct: 50.0, stripe_transfer_id: 'tr_seed_pdrlead_0005', status: 'PAID' },
  { id: '00000000-0000-0000-0000-0000000aa002', ro_id: '00000000-0000-0000-0000-00000000a6f5', tech_user_id: null, split_role: 'SALES', gross_amount: 5000.0, tech_split_pct: 10.0, stripe_transfer_id: 'tr_seed_sales_0005', status: 'PAID' },
  { id: '00000000-0000-0000-0000-0000000aa003', ro_id: '00000000-0000-0000-0000-00000000a6f5', tech_user_id: null, split_role: 'HOUSE', gross_amount: 5000.0, tech_split_pct: 40.0, stripe_transfer_id: null, status: 'PENDING' },
];

/* ---- Helpers -------------------------------------------------------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolves an existing user's id by signing in with its known seed password.
 * (This project's Auth Admin `listUsers` returns 500, so we avoid it.)
 */
async function signInForId(email) {
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error || !data?.user) {
    throw new Error(`sign-in lookup failed for ${email}: ${error?.message ?? 'no user'}`);
  }
  return data.user.id;
}

/**
 * Returns { id, created } for an account: create the auth user, or — if it
 * already exists — discover its id by signing in. Retries transient errors.
 */
async function resolveAuthUserId(email) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (!error && data?.user) return { id: data.user.id, created: true };

    const msg = error?.message ?? '';
    const status = error?.status ?? 0;

    if (/already|registered|exists/i.test(msg) || status === 422) {
      return { id: await signInForId(email), created: false };
    }

    const transient =
      status === 429 || status >= 500 || msg === '' || /rate|too many|timeout|temporar/i.test(msg);
    if (transient && attempt < 5) {
      await sleep(attempt * 1000);
      continue;
    }
    throw new Error(`createUser(${email}) failed: ${msg || `status ${status || 'unknown'}`}`);
  }
  throw new Error(`createUser(${email}) failed after retries.`);
}

async function upsert(table, rows) {
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
  if (error) {
    console.error(`  ✗ ${table}: ${error.message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${table} (${rows.length})`);
}

/* ---- Main ----------------------------------------------------------------- */
async function main() {
  console.log(`Seeding ${URL} …`);

  await upsert('organizations', ORGANIZATIONS);
  await upsert('locations', LOCATIONS);

  console.log('Ensuring auth users (password: password123) …');
  const userRows = [];
  for (const a of ACCOUNTS) {
    const { id, created } = await resolveAuthUserId(a.email);
    console.log(`  ${created ? '✓' : '='} ${a.email} → ${id}${created ? '' : ' (existing)'}`);
    userRows.push({
      id: a.id,
      auth_user_id: id,
      organization_id: a.organization_id,
      role: a.role,
      full_name: a.full_name,
      email: a.email,
    });
    await sleep(300); // gentle pacing to avoid Auth rate limits
  }
  await upsert('users', userRows);

  await upsert('vehicles', VEHICLES);
  await upsert('repair_orders', REPAIR_ORDERS);
  await upsert('total_loss_audits', TOTAL_LOSS_AUDITS);
  await upsert('hold_gate_logs', HOLD_GATE_LOGS);
  await upsert('proof_of_payments', PROOF_OF_PAYMENTS);
  await upsert('payout_splits', PAYOUT_SPLITS);

  console.log('\nDone. Log in at /login with any seeded email + password123.');
}

main().catch((err) => {
  const detail =
    err instanceof Error ? err.message : (JSON.stringify(err) || String(err));
  console.error('Seed failed:', detail);
  process.exit(1);
});
