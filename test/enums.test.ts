import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CORE_ENUMS } from '../src/enums.js';
import { assetCoreMigrate } from '../src/migrate.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';

describe('enum parity (TS constants ↔ pg_enum)', () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase('ac_enums');
    await assetCoreMigrate({ client: db.admin });
  });
  afterAll(async () => {
    await db.drop();
  });

  it('every core enum has the same values in the same order', async () => {
    const { rows } = await db.admin.query<{ name: string; labels: string[] }>(
      `SELECT t.typname AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
         FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = 'core' GROUP BY 1 ORDER BY 1`,
    );
    const db_ = Object.fromEntries(rows.map((r) => [r.name, r.labels]));
    expect(Object.keys(db_).sort()).toEqual(Object.keys(CORE_ENUMS).sort());
    for (const [name, values] of Object.entries(CORE_ENUMS)) expect(db_[name]).toEqual([...values]);
  });
});
