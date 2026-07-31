-- ============================================================================
-- MESH — rental_vehicles: two-phase reservation (RESERVED status)
--
-- Book Shop Drop-off currently jumps straight to RENTED with placeholder
-- mileage/fuel (0 / 100) since the routing-panel picker never actually
-- collects real numbers — those are only captured at physical handoff. Adds
-- RESERVED as a genuine hold state between AVAILABLE and RENTED: booking a
-- drop-off reserves a unit (blocks it from other leads) without fabricating
-- checkout data; the Fleet Command Center confirms pickup (→ RENTED, real
-- mileage/fuel) or releases the hold (→ AVAILABLE) later.
--
-- Additive: widens the existing status CHECK constraint in place, no table
-- rebuild — the live seeded rows are untouched.
-- ============================================================================

alter table public.rental_vehicles drop constraint if exists rental_vehicles_status_check;
alter table public.rental_vehicles add constraint rental_vehicles_status_check
  check (status in ('AVAILABLE','RESERVED','RENTED','MAINTENANCE'));
