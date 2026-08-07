-- ============================================================================
-- MESH — intake_leads.loaner_requested_unfulfilled
--
-- Records an unmet loaner need durably instead of letting it silently drop.
-- Before this column, MobileIntakeWizard's step 4 blocked the rep from
-- advancing at all when the rep wanted to provide a loaner but no fleet
-- vehicle was available (canProceed() required selectedVehicleId !== null)
-- — the only way through was toggling the loaner request off, which
-- discarded the customer's need with no record it was ever expressed.
--
-- Covers two distinct cases, both invisible after the wizard session ended
-- prior to this column:
--   1. No fleet vehicle was AVAILABLE at intake — nothing could be reserved
--      or assigned at all.
--   2. A vehicle WAS reserved, but key release is held pending driver
--      license/insurance documents (handoverAllowed === false in the
--      wizard/Fleet handover gate). Previously surfaced only as a one-time
--      dismissable toast on the Sales board (sales/page.tsx's `notice`),
--      never persisted anywhere.
--
-- Cleared when a vehicle is later actually assigned to the lead (RENTED via
-- rental-db.ts's assignVehicle — called from both the wizard's own
-- successful-handover path and Fleet's confirmAssign) — i.e. once the need
-- is genuinely fulfilled, not merely reserved.
-- ============================================================================

alter table public.intake_leads
  add column if not exists loaner_requested_unfulfilled boolean not null default false;

comment on column public.intake_leads.loaner_requested_unfulfilled is
  'True when the customer wanted a loaner but it was not fulfilled at intake — either no fleet vehicle was available, or one was reserved but keys are held pending driver documents. Cleared once a vehicle is actually assigned (RENTED) to this lead.';
