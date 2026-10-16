import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assetCoreMigrate, assetCoreStatus, coreMigrations, coreMigrationSql } from '../src/migrate.js';
import { CORE_TABLES } from '../src/types.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';

describe('asset-core migrate', () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase('ac_migrate');
  });
  afterAll(async () => {
    await db.drop();
  });

  it('applies every migration from an empty database', async () => {
    const result = await assetCoreMigrate({ databaseUrl: db.url });
    expect(result.applied).toEqual(coreMigrations.map((m) => m.id));
    const { rows } = await db.admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'core' AND table_name <> '_migration' ORDER BY 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([...CORE_TABLES].sort());
    expect(rows).toHaveLength(18);
  });

  it('is idempotent: a second run applies nothing', async () => {
    const result = await assetCoreMigrate({ databaseUrl: db.url });
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toHaveLength(coreMigrations.length);
    const status = await assetCoreStatus({ databaseUrl: db.url });
    expect(status.every((s) => s.state === 'applied')).toBe(true);
  });

  it('serialises concurrent runners (advisory lock)', async () => {
    const results = await Promise.all([1, 2, 3].map(() => assetCoreMigrate({ databaseUrl: db.url })));
    expect(results.flatMap((r) => r.applied)).toEqual([]);
  });

  it('enables and forces row-level security on every core table', async () => {
    const { rows } = await db.admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'core' AND c.relkind = 'r' AND c.relname <> '_migration'`,
    );
    expect(rows).toHaveLength(18);
    for (const r of rows) {
      expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, true, true]);
    }
  });

  it('refuses to run when an applied migration was edited (checksum mismatch)', async () => {
    await db.admin.query(`UPDATE core._migration SET checksum = repeat('0', 64) WHERE id = $1`, [
      coreMigrations[2]!.id,
    ]);
    await expect(assetCoreMigrate({ databaseUrl: db.url })).rejects.toThrow(/edited after it was applied/);
    const status = await assetCoreStatus({ databaseUrl: db.url });
    expect(status.find((s) => s.id === coreMigrations[2]!.id)?.state).toBe('checksum_mismatch');
    await db.admin.query(`UPDATE core._migration SET checksum = $2 WHERE id = $1`, [
      coreMigrations[2]!.id,
      coreMigrations[2]!.checksum,
    ]);
  });

  it('refuses to run against a database migrated by a newer package', async () => {
    await db.admin.query(
      `INSERT INTO core._migration (id, checksum, package_version, execution_ms) VALUES ('9999_from_the_future', repeat('f', 64), '9.9.9', 1)`,
    );
    await expect(assetCoreMigrate({ databaseUrl: db.url })).rejects.toThrow(
      /database is newer than the package/,
    );
    await db.admin.query(`DELETE FROM core._migration WHERE id = '9999_from_the_future'`);
  });

  it('keeps the migration ledger away from the application roles', async () => {
    const { rows } = await db.admin.query<{ app: boolean; platform: boolean }>(
      `SELECT has_table_privilege('gp_app', 'core._migration', 'SELECT') AS app,
              has_table_privilege('gp_platform', 'core._migration', 'SELECT') AS platform`,
    );
    expect(rows[0]).toEqual({ app: false, platform: true });
  });

  it('reports pending migrations in a dry run without applying them', async () => {
    const fresh = await createTestDatabase('ac_dry');
    try {
      const result = await assetCoreMigrate({ databaseUrl: fresh.url, dryRun: true });
      expect(result.pending).toHaveLength(coreMigrations.length);
      const { rows } = await fresh.admin.query(`SELECT count(*)::int AS n FROM core._migration`);
      expect(rows[0]).toEqual({ n: 0 });
    } finally {
      await fresh.drop();
    }
  });

  it('exposes all migrations as one script (Prisma initShadowDb)', async () => {
    const fresh = await createTestDatabase('ac_script');
    try {
      await fresh.admin.query(coreMigrationSql());
      const { rows } = await fresh.admin.query(
        `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'core'`,
      );
      expect(rows[0]).toEqual({ n: 18 });
    } finally {
      await fresh.drop();
    }
  });
});
