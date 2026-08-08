-- ============================================================================
-- MESH Sales & Intake — simplify intake_leads.status, add lost_reason
--
-- Collapses LeadStatus from 9 values to 5: NEW, CONTACTED, AOB_SIGNED,
-- CONVERTED, LOST.
--
-- ESTIMATE_SENT -> CONTACTED, APPROVED -> AOB_SIGNED: both were legacy
-- granular sub-states with zero live rows and no live writer as of this
-- migration (nothing in the app has offered either as a selectable status
-- since the board moved to 4 streamlined columns — statusToStage() in
-- src/app/dashboard/sales/page.tsx already folds them this exact way for
-- display). This makes that fold the actual stored value instead of a
-- presentation-layer patch over stale data.
--
-- LOST_TO_COMPETITOR, CANCELLED -> LOST: collapsed into one terminal status.
-- The distinction they used to carry now lives in the new lost_reason
-- column instead of a separate status value, per the fixed-set-not-free-text
-- lesson from the original 'DEAD - GHOSTED'-style status values.
-- ============================================================================

-- --- lost_reason ---------------------------------------------------------
-- Added before the backfill below so the backfill can populate it in the
-- same migration. Fixed set, extended by migration only — same pattern as
-- vehicle_documents.kind (20260806030000_vehicle_documents.sql). Nullable:
-- only ever set when status = 'LOST' (enforced at the application layer,
-- not by a cross-column DB constraint).
alter table public.intake_leads
  add column lost_reason text
    check (lost_reason in (
      'LOST_TO_COMPETITOR', 'CUSTOMER_CANCELLED', 'PRICE', 'NO_RESPONSE',
      'OUT_OF_SCOPE', 'OTHER'
    ));

-- --- backfill lost_reason for rows collapsing into LOST -------------------
-- Written even though no live rows currently hold LOST_TO_COMPETITOR or
-- CANCELLED, so a fresh environment (or one seeded before this migration
-- ran) ends up correct rather than with a LOST row and a null reason.
update public.intake_leads set lost_reason = 'LOST_TO_COMPETITOR'
  where status = 'LOST_TO_COMPETITOR';
update public.intake_leads set lost_reason = 'CUSTOMER_CANCELLED'
  where status = 'CANCELLED';

-- --- backfill status values ------------------------------------------------
update public.intake_leads set status = 'CONTACTED' where status = 'ESTIMATE_SENT';
update public.intake_leads set status = 'AOB_SIGNED' where status = 'APPROVED';
update public.intake_leads set status = 'LOST'
  where status in ('LOST_TO_COMPETITOR', 'CANCELLED');

-- --- replace the status CHECK constraint -----------------------------------
-- intake_leads_status_check is the default name Postgres gave the inline
-- column check in 20260726000000_intake_leads.sql (never explicitly named,
-- never altered since — confirmed by grepping every migration that touches
-- intake_leads for a second check on this column; there isn't one).
alter table public.intake_leads drop constraint if exists intake_leads_status_check;
alter table public.intake_leads
  add constraint intake_leads_status_check
    check (status in ('NEW', 'CONTACTED', 'AOB_SIGNED', 'CONVERTED', 'LOST'));
