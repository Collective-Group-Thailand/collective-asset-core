import pg from 'pg';

import { type EmbeddedMigration, MIGRATIONS, PACKAGE_VERSION } from './generated/assets.js';

/** The table that records applied core migrations (ADR-0010). */
export const MIGRATION_TABLE = 'core._migration';
/** pg_advisory_lock key serialising concurrent runners ("asset-core" as two int4). */
const LOCK_KEY: [number, number] = [0x61737365, 0x74636f72];

export type CoreMigration = EmbeddedMigration;

/** The migrations shipped in this package version, in apply order. */
export const coreMigrations: readonly CoreMigration[] = MIGRATIONS;

/**
 * All core migrations as one SQL script, e.g. for Prisma's `migrations.initShadowDb` (so `prisma migrate
 * diff/dev` see the core tables the app's migrations reference) or for `psql -f`.
 */
export function coreMigrationSql(): string {
  return coreMigrations.map((m) => `-- ${m.id}\n${m.sql}`).join('\n');
}

export class AssetCoreMigrationError extends Error {
  constructor(
    message: string,
    readonly migrationId?: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AssetCoreMigrationError';
  }
}

/** A `pg` client or anything with the same `query` method (Pool clients, test doubles). */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface MigrateOptions {
  /** Connection string; ignored when `client` is given. Defaults to `DATABASE_URL`. */
  databaseUrl?: string;
  /** An open connection to use instead of opening one (not closed by the runner). */
  client?: SqlClient;
  /** Report what would run without applying anything. */
  dryRun?: boolean;
  /** Progress output (default: nothing). */
  log?: (line: string) => void;
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: string[];
  pending: string[];
}

export interface MigrationStatus {
  id: string;
  checksum: string;
  appliedAt: Date | null;
  state: 'applied' | 'pending' | 'checksum_mismatch' | 'unknown';
}

const BOOTSTRAP_SQL = `
CREATE SCHEMA IF NOT EXISTS core;
CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
  id              text PRIMARY KEY,
  checksum        char(64) NOT NULL,
  package_version text NOT NULL,
  applied_at      timestamptz NOT NULL DEFAULT now(),
  execution_ms    integer NOT NULL
);
COMMENT ON TABLE ${MIGRATION_TABLE} IS 'Applied @collective/asset-core migrations (asset-core migrate). Never edit by hand.';`;

/**
 * Applies pending `core` migrations in order, each in its own transaction, recording them in
 * `core._migration` with their checksum. Idempotent: applied migrations are skipped. Refuses to run when an
 * applied migration's SQL was edited (checksum mismatch) or when the database knows a migration this package
 * version does not ship (database newer than the package). Concurrent runners serialise on an advisory lock.
 * App repositories run this before their own Prisma migrations (`pnpm db:migrate`).
 */
export async function assetCoreMigrate(options: MigrateOptions = {}): Promise<MigrateResult> {
  const log = options.log ?? (() => undefined);
  let owned: pg.Client | undefined;
  let db: SqlClient;
  if (options.client) {
    db = options.client;
  } else {
    const url = options.databaseUrl ?? process.env.DATABASE_URL;
    if (!url)
      throw new AssetCoreMigrationError(
        'asset-core migrate: no database URL (pass --url or set DATABASE_URL)',
      );
    owned = new pg.Client({ connectionString: url, application_name: 'asset-core-migrate' });
    await owned.connect();
    db = owned;
  }

  try {
    await db.query('SELECT pg_advisory_lock($1, $2)', LOCK_KEY);
    try {
      await db.query(BOOTSTRAP_SQL);
      const status = await readStatus(db);
      const problems = status.filter((s) => s.state === 'checksum_mismatch' || s.state === 'unknown');
      if (problems.length > 0) {
        throw new AssetCoreMigrationError(
          problems
            .map((p) =>
              p.state === 'unknown'
                ? `migration ${p.id} is recorded in ${MIGRATION_TABLE} but not shipped by @collective/asset-core@${PACKAGE_VERSION} (database is newer than the package)`
                : `migration ${p.id} was edited after it was applied (checksum mismatch) — ship a new migration instead`,
            )
            .join('; '),
          problems[0]?.id,
        );
      }
      const pending = coreMigrations.filter((m) => status.find((s) => s.id === m.id)?.state === 'pending');
      const result: MigrateResult = {
        applied: [],
        alreadyApplied: status.filter((s) => s.state === 'applied').map((s) => s.id),
        pending: pending.map((m) => m.id),
      };
      if (options.dryRun) {
        for (const m of pending) log(`asset-core: would apply ${m.id}`);
        return result;
      }
      const definerGrant = pending.length > 0 ? await grantDefinerOwnerCreate(db) : false;
      try {
        await applyPending(db, pending, result, log);
      } finally {
        if (definerGrant) await db.query('REVOKE CREATE ON SCHEMA core FROM gp_platform');
      }
      // The application roles must not touch the ledger of applied migrations.
      await db.query(`DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gp_app') THEN
            REVOKE ALL ON ${MIGRATION_TABLE} FROM gp_app, gp_reporting;
            GRANT SELECT ON ${MIGRATION_TABLE} TO gp_platform;
          END IF;
        END $$`);
      if (result.applied.length === 0) log('asset-core: core schema is up to date');
      return result;
    } finally {
      await db.query('SELECT pg_advisory_unlock($1, $2)', LOCK_KEY).catch(() => undefined);
    }
  } finally {
    await owned?.end();
  }
}

/**
 * Non-superuser runners (0.4.0): the Collective platform migrates as the product login — owner of its database,
 * `NOCREATEROLE`, member of the group roles its postgres init script created. Migration 0007 hands the SECURITY
 * DEFINER helpers to `gp_platform` (`ALTER FUNCTION … OWNER TO gp_platform`), which PostgreSQL allows only when the
 * new owner may CREATE in the schema. When the runner is not a superuser, `gp_platform` already exists and lacks
 * that right, the runner (owner of `core`) grants it for the duration of the pending migrations; the caller revokes it
 * afterwards, so `gp_platform` keeps no DDL right on `core` at run time. Returns whether it granted.
 */
async function grantDefinerOwnerCreate(db: SqlClient): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
            EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gp_platform') AS platform_role`,
  );
  if (rows[0]?.superuser === true || rows[0]?.platform_role !== true) return false;
  const has = await db.query(`SELECT has_schema_privilege('gp_platform', 'core', 'CREATE') AS can`);
  if (has.rows[0]?.can === true) return false;
  await db.query('GRANT CREATE ON SCHEMA core TO gp_platform');
  return true;
}

async function applyPending(
  db: SqlClient,
  pending: readonly CoreMigration[],
  result: MigrateResult,
  log: (line: string) => void,
): Promise<void> {
  for (const m of pending) {
    const started = Date.now();
    await db.query('BEGIN');
    try {
      await db.query(m.sql);
      await db.query(
        `INSERT INTO ${MIGRATION_TABLE} (id, checksum, package_version, execution_ms) VALUES ($1, $2, $3, $4)`,
        [m.id, m.checksum, PACKAGE_VERSION, Date.now() - started],
      );
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw new AssetCoreMigrationError(
        `asset-core migration ${m.id} failed: ${(error as Error).message}`,
        m.id,
        error,
      );
    }
    result.applied.push(m.id);
    log(`asset-core: applied ${m.id} (${Date.now() - started} ms)`);
  }
}

/** Applied/pending state of every shipped migration (plus unknown ones found in the database). */
export async function assetCoreStatus(
  options: Omit<MigrateOptions, 'dryRun'> = {},
): Promise<MigrationStatus[]> {
  let owned: pg.Client | undefined;
  let db: SqlClient;
  if (options.client) db = options.client;
  else {
    const url = options.databaseUrl ?? process.env.DATABASE_URL;
    if (!url)
      throw new AssetCoreMigrationError(
        'asset-core status: no database URL (pass --url or set DATABASE_URL)',
      );
    owned = new pg.Client({ connectionString: url, application_name: 'asset-core-status' });
    await owned.connect();
    db = owned;
  }
  try {
    const { rows } = await db.query(`SELECT to_regclass('${MIGRATION_TABLE}') IS NOT NULL AS present`);
    if (!rows[0]?.present) {
      return coreMigrations.map((m) => ({
        id: m.id,
        checksum: m.checksum,
        appliedAt: null,
        state: 'pending' as const,
      }));
    }
    return await readStatus(db);
  } finally {
    await owned?.end();
  }
}

async function readStatus(db: SqlClient): Promise<MigrationStatus[]> {
  const { rows } = await db.query(`SELECT id, checksum, applied_at FROM ${MIGRATION_TABLE} ORDER BY id`);
  const applied = new Map(rows.map((r) => [String(r.id), r]));
  const status: MigrationStatus[] = coreMigrations.map((m) => {
    const row = applied.get(m.id);
    applied.delete(m.id);
    if (!row) return { id: m.id, checksum: m.checksum, appliedAt: null, state: 'pending' };
    return {
      id: m.id,
      checksum: m.checksum,
      appliedAt: row.applied_at as Date,
      state: String(row.checksum).trim() === m.checksum ? 'applied' : 'checksum_mismatch',
    };
  });
  for (const [id, row] of applied) {
    status.push({ id, checksum: String(row.checksum), appliedAt: row.applied_at as Date, state: 'unknown' });
  }
  return status;
}
