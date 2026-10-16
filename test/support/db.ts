import { randomBytes } from 'node:crypto';

import pg from 'pg';
import { inject } from 'vitest';

import { configurePgTypes } from '../../src/pg-types.js';

configurePgTypes(pg.types);

export interface TestDatabase {
  url: string;
  name: string;
  /** Superuser connection to the test database (bypasses RLS). */
  admin: pg.Client;
  drop(): Promise<void>;
}

/** Creates a fresh, empty database on the shared test cluster. */
export async function createTestDatabase(prefix = 'ac'): Promise<TestDatabase> {
  const adminUrl = inject('adminUrl');
  const name = `${prefix}_${randomBytes(6).toString('hex')}`;
  const server = new pg.Client({ connectionString: adminUrl });
  await server.connect();
  await server.query(`CREATE DATABASE ${name}`);
  await server.end();
  const url = adminUrl.replace(/\/[^/]*$/, `/${name}`);
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  return {
    url,
    name,
    admin,
    async drop() {
      await admin.end().catch(() => undefined);
      const s = new pg.Client({ connectionString: adminUrl });
      await s.connect();
      await s.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await s.end();
    },
  };
}
