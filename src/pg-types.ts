/** The part of `pg.types` used here (avoids a type dependency on @types/pg for consumers). */
export interface PgTypeRegistry {
  setTypeParser(oid: number, parser: (value: string) => unknown): void;
}

/** PostgreSQL type oids whose default `pg` parsing loses information. */
export const PG_OIDS = { date: 1082, numeric: 1700, int8: 20 } as const;

/**
 * Makes `pg` return `date` columns as 'YYYY-MM-DD' strings (instead of local-midnight Date objects that shift
 * across time zones) and keeps `numeric`/`bigint` as strings (D-046: money is never a JS number). Call once at
 * start-up with `pg.types`.
 */
export function configurePgTypes(types: PgTypeRegistry): void {
  types.setTypeParser(PG_OIDS.date, (v) => v);
  types.setTypeParser(PG_OIDS.numeric, (v) => v);
  types.setTypeParser(PG_OIDS.int8, (v) => v);
}
