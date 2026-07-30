/**
 * MESH — UUID shape guard for RO-scoped DAL reads.
 *
 * Board orders can carry non-UUID ids (sample/fallback data, e.g. 'mock-a6f1')
 * while the real repair_order_id columns they'd be queried against are
 * Postgres `uuid`. Passing a non-UUID string into `.eq('repair_order_id', id)`
 * causes PostgREST to reject the query with "invalid input syntax for type
 * uuid" — a real query error that db-guard's executeDBOperation re-throws in
 * production (correctly, for genuine DB failures). But a malformed lookup key
 * isn't a DB failure to alert on; it's an expected, routine case whenever
 * sample data is still in play. DAL reads should check this BEFORE querying
 * and go straight to their local fallback, rather than risk that crash.
 * Mirrors the UUID_REGEX already used in sales-db.ts's convertLeadToRO.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}
