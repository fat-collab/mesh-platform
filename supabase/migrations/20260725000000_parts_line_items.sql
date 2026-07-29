-- ============================================================================
-- MESH Platform — parts_line_items
--
-- Persistence for the RO Detail drawer's Parts Operations panel: ordering
-- lifecycle, invoice capture, and discrepancy handling. Keyed by claim_number
-- (matching repair_orders.claim_number) so the drawer can look items up without
-- threading RO ids. Multi-tenant RLS mirrors the init migration: a row is
-- visible/editable to members of the org that owns the matching repair order.
-- ============================================================================

create table if not exists public.parts_line_items (
  id                        uuid primary key default gen_random_uuid(),
  claim_number              text,
  part_number               text,
  description               text,
  vendor_name               text,
  quantity                  int,
  unit_cost                 numeric(12,2),
  status                    text not null default 'NEEDED'
    check (status in ('NEEDED','ORDERED','IN_TRANSIT','RECEIVED','DISCREPANCY')),
  sourcing_tier             text not null default 'OEM'
    check (sourcing_tier in ('OEM','LKQ','AFTERMARKET','RECONDITIONED')),
  capa_certified            boolean,
  invoice_number            text,
  invoice_url               text,
  received_at               timestamptz,
  discrepancy_reason        text
    check (discrepancy_reason is null or discrepancy_reason in
      ('DAMAGED_IN_TRANSIT','WRONG_PART_NUMBER','INCORRECT_FITMENT','DEFECTIVE','MISSING_HARDWARE')),
  discrepancy_notes         text,
  return_rma_number         text,
  replacement_expected_date text,
  created_at                timestamptz not null default now()
);

create index if not exists parts_line_items_claim_number_idx
  on public.parts_line_items (claim_number);

-- --- RLS --------------------------------------------------------------------
alter table public.parts_line_items enable row level security;

drop policy if exists parts_line_items_select on public.parts_line_items;
create policy parts_line_items_select on public.parts_line_items
  for select using (
    claim_number in (
      select claim_number from public.repair_orders
      where organization_id = public.current_user_org_id()
    )
  );

drop policy if exists parts_line_items_modify on public.parts_line_items;
create policy parts_line_items_modify on public.parts_line_items
  for all using (
    claim_number in (
      select claim_number from public.repair_orders
      where organization_id = public.current_user_org_id()
    )
  ) with check (
    claim_number in (
      select claim_number from public.repair_orders
      where organization_id = public.current_user_org_id()
    )
  );

-- --- demo seed (idempotent) -------------------------------------------------
-- Mirrors src/lib/ops-mock.ts so the DB-backed path shows the same sample data.
insert into public.parts_line_items
  (id, claim_number, description, status, sourcing_tier, capa_certified,
   invoice_number, invoice_url,
   discrepancy_reason, discrepancy_notes, return_rma_number, replacement_expected_date)
values
  ('00000000-0000-0000-0000-0000000a0001', 'APX-2026-0001', 'Rear quarter panel (LH)', 'RECEIVED', 'OEM', null, 'INV-88123', 'https://parts.example.com/invoices/INV-88123.pdf', null, null, null, null),
  ('00000000-0000-0000-0000-0000000a0002', 'APX-2026-0001', 'LED headlight assembly (RH)', 'IN_TRANSIT', 'AFTERMARKET', true, null, null, null, null, null, null),
  ('00000000-0000-0000-0000-0000000a0003', 'APX-2026-0001', 'Front bumper absorber', 'ORDERED', 'LKQ', null, null, null, null, null, null, null),
  ('00000000-0000-0000-0000-0000000a0004', 'APX-2026-0003', 'Front bumper cover', 'DISCREPANCY', 'AFTERMARKET', false, null, null, 'DAMAGED_IN_TRANSIT', 'Deep gouge on lower valance, corner tab cracked.', 'RMA-40551', '2026-08-03'),
  ('00000000-0000-0000-0000-0000000a0005', 'APX-2026-0003', 'Radiator support', 'RECEIVED', 'OEM', null, 'INV-88090', null, null, null, null, null),
  ('00000000-0000-0000-0000-0000000a0006', 'APX-2026-0004', 'Hood panel (aluminum)', 'DISCREPANCY', 'OEM', null, null, null, 'INCORRECT_FITMENT', 'Hinge holes misaligned ~6mm; will not seat.', 'RMA-40560', '2026-08-10'),
  ('00000000-0000-0000-0000-0000000a0007', 'APX-2026-0004', 'Grille assembly', 'NEEDED', 'AFTERMARKET', true, null, null, null, null, null, null),
  ('00000000-0000-0000-0000-0000000a0008', 'APX-2026-0004', 'Windshield', 'ORDERED', 'OEM', null, null, null, null, null, null, null),
  ('00000000-0000-0000-0000-0000000a0009', 'BRG-2026-0001', 'Condenser', 'IN_TRANSIT', 'LKQ', null, null, null, null, null, null, null),
  ('00000000-0000-0000-0000-0000000a0010', 'BRG-2026-0001', 'AC compressor', 'ORDERED', 'RECONDITIONED', null, null, null, null, null, null, null),
  ('00000000-0000-0000-0000-0000000a0011', 'BRG-2026-0001', 'Fender liner (RH)', 'NEEDED', 'AFTERMARKET', false, null, null, null, null, null, null)
on conflict (id) do nothing;
