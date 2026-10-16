import type { SqlClient } from './migrate.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE = /^[a-z_][a-z0-9_]*$/;

export type ActorKind = 'operator' | 'resident' | 'technician' | 'platform' | 'device' | 'system';

export interface TenantScopeOptions {
  /** The acting core.user_account (→ `app.actor_id`; lets a user read its own core.user_account row). */
  actorId?: string | null;
  actorKind?: ActorKind;
  /**
   * `SET LOCAL ROLE` for the transaction, e.g. `gp_app` when the connection user is a member of it but not
   * the role itself (local development connects as a superuser; RLS only applies after switching).
   */
  role?: string;
}

/** A `pg.Pool` (recognised by its `totalCount`): a connection is checked out per call. */
export interface PoolLike {
  readonly totalCount: number;
  connect(): Promise<SqlClient & { release(error?: Error | boolean): void }>;
}

function isPool(x: SqlClient | PoolLike): x is PoolLike {
  return typeof (x as Partial<PoolLike>).totalCount === 'number';
}

/**
 * The statements that scope one transaction to a tenant (schema-design §4.5): `set_config(…, true)` is
 * `SET LOCAL` with bind parameters, so the values die with the transaction and are pool-safe.
 */
export function tenantScopeStatements(
  tenantId: string,
  options: TenantScopeOptions = {},
): { text: string; values: unknown[] }[] {
  if (!UUID.test(tenantId)) throw new TypeError(`withTenant: tenantId must be a uuid, got "${tenantId}"`);
  if (options.actorId != null && !UUID.test(options.actorId)) {
    throw new TypeError(`withTenant: actorId must be a uuid, got "${options.actorId}"`);
  }
  const statements: { text: string; values: unknown[] }[] = [];
  if (options.role) {
    if (!ROLE.test(options.role)) throw new TypeError(`withTenant: invalid role name "${options.role}"`);
    statements.push({ text: `SET LOCAL ROLE ${options.role}`, values: [] });
  }
  statements.push({
    text: `SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), set_config('app.actor_kind', $3, true)`,
    values: [tenantId, options.actorId ?? '', options.actorKind ?? ''],
  });
  return statements;
}

/**
 * Runs `fn` in one transaction with `app.tenant_id` (and optionally `app.actor_id` / a role) set via
 * SET LOCAL, so every statement inside is subject to the tenant's row-level security policies.
 * Accepts a pool (a connection is checked out and released) or a single connection (must not already be in a
 * transaction). Commits when `fn` resolves, rolls back when it throws.
 */
export async function withTenant<T>(
  clientOrPool: SqlClient | PoolLike,
  tenantId: string,
  fn: (client: SqlClient) => Promise<T>,
  options: TenantScopeOptions = {},
): Promise<T> {
  const statements = tenantScopeStatements(tenantId, options);
  const pooled = isPool(clientOrPool);
  const client = pooled ? await clientOrPool.connect() : clientOrPool;
  let failed = false;
  try {
    await client.query('BEGIN');
    try {
      for (const s of statements) await client.query(s.text, s.values);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      failed = true;
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    if (pooled) (client as SqlClient & { release(e?: boolean): void }).release(failed);
  }
}
