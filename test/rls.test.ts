import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assetCoreMigrate } from '../src/migrate.js';
import { type TenantScopeOptions, withTenant } from '../src/tenant-scope.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';
import { B, P, seedRlsWorld, T, U, USER } from './support/fixtures.js';

/**
 * RLS matrix (schema-design v2 §4.5 "Tests (DoD)"): the test connects as a superuser and switches to gp_app /
 * gp_reporting with SET LOCAL ROLE inside withTenant(), exactly as a deployment whose login user is a member of
 * those roles.
 */
describe('row-level security on core tables', () => {
  let db: TestDatabase;
  const as = <R>(
    tenantId: string,
    fn: (q: (sql: string, params?: unknown[]) => Promise<R[]>) => Promise<unknown>,
    opts: TenantScopeOptions = {},
  ) =>
    withTenant(
      db.admin,
      tenantId,
      (c) => fn(async (sql, params) => (await c.query(sql, params)).rows as R[]),
      { role: 'gp_app', ...opts },
    );
  const ids = async (tenantId: string, sql: string, opts: TenantScopeOptions = {}): Promise<string[]> => {
    let out: string[] = [];
    await as<{ id: string }>(
      tenantId,
      async (q) => {
        out = (await q(sql)).map((r) => r.id).sort();
      },
      opts,
    );
    return out;
  };

  beforeAll(async () => {
    db = await createTestDatabase('ac_rls');
    await assetCoreMigrate({ client: db.admin });
    await seedRlsWorld(db.admin);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('a tenant sees its own units and never another tenant’s', async () => {
    expect(await ids(T.aptA, 'SELECT id FROM core.unit')).toEqual([U.aptA1]);
    expect(await ids(T.aptB, 'SELECT id FROM core.unit')).toEqual([U.aptB1]);
    expect(await ids(T.aptA, `SELECT id FROM core.unit WHERE id = '${U.aptB1}'`)).toEqual([]);
    expect(await ids(T.aptA, 'SELECT id FROM core.tenant')).toEqual([T.aptA]);
  });

  it('without app.tenant_id nothing is visible', async () => {
    await db.admin.query('BEGIN');
    try {
      await db.admin.query('SET LOCAL ROLE gp_app');
      const { rows } = await db.admin.query('SELECT id FROM core.unit');
      expect(rows).toEqual([]);
    } finally {
      await db.admin.query('ROLLBACK');
    }
  });

  it('owner tenant and operator tenant both see a PM-operated building and its units', async () => {
    for (const t of [T.juristic, T.pm]) {
      expect(await ids(t, 'SELECT id FROM core.building')).toEqual([B.condo]);
      expect(await ids(t, 'SELECT id FROM core.unit')).toEqual([U.condo1, U.condo2].sort());
    }
    // the operator also sees the owner's property through the building
    expect(await ids(T.juristic, 'SELECT id FROM core.property')).toEqual([
      '0199f1c2-0005-7000-8000-00000000000c',
    ]);
    expect(await ids(T.aptA, 'SELECT id FROM core.building')).toEqual([B.aptA]);
  });

  it('the operator writes rows on behalf of the owner (acts_for) but not for anyone else', async () => {
    await as(T.pm, async (q) => {
      await q(`INSERT INTO core.floor (tenant_id, building_id, level, name) VALUES ($1, $2, 1, 'Floor 1')`, [
        T.juristic,
        B.condo,
      ]);
    });
    await expect(
      as(T.pm, (q) =>
        q(`INSERT INTO core.floor (tenant_id, building_id, level, name) VALUES ($1, $2, 2, 'x')`, [
          T.aptA,
          B.condo,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(T.aptA, (q) =>
        q(`INSERT INTO core.unit (tenant_id, building_id, property_id, unit_no) VALUES ($1, $2, $3, 'X')`, [
          T.aptB,
          B.aptB,
          '0199f1c2-0005-7000-8000-00000000000b',
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  describe('asset_access_grant', () => {
    beforeAll(async () => {
      // the juristic person (owner) grants the landlord its unit C-101 for leasing and billing
      await as(T.juristic, (q) =>
        q(
          `INSERT INTO core.asset_access_grant (tenant_id, grantee_tenant_id, building_id, unit_id, scope, modules, access, reason)
           VALUES ($1, $2, $3, $4, 'unit', '{ops.lease,ops.billing}', 'write', 'landlord_unit')`,
          [T.juristic, T.landlord, B.condo, U.condo1],
        ),
      );
    });

    it('a unit grant shows exactly that unit, for the granted modules only', async () => {
      expect(await ids(T.landlord, 'SELECT id FROM core.unit')).toEqual([U.condo1]);
      // occupancy follows ops.lease: the landlord sees who lives in its unit (its own row and the juristic's)
      const occ = await ids(T.landlord, 'SELECT unit_id AS id FROM core.occupancy');
      expect(occ).toEqual([U.condo1]);
      // unit_ownership and meters are core.asset / smart.metering: not granted
      expect(await ids(T.landlord, 'SELECT id FROM core.unit_ownership')).toEqual([]);
      expect(await ids(T.landlord, 'SELECT id FROM core.meter_assignment')).toEqual([]);
      // a unit grant does not open the building row
      expect(await ids(T.landlord, 'SELECT id FROM core.building')).toEqual([]);
    });

    it('a building grant for one module opens that module only', async () => {
      await as(T.pm, (q) =>
        q(
          `INSERT INTO core.asset_access_grant (tenant_id, grantee_tenant_id, building_id, scope, modules, reason)
           VALUES ($1, $2, $3, 'building', '{smart.metering}', 'contractor')`,
          [T.pm, T.aptB, B.condo],
        ),
      );
      expect(await ids(T.aptB, 'SELECT building_id AS id FROM core.meter_assignment')).toEqual([B.condo]);
      expect(await ids(T.aptB, `SELECT id FROM core.asset_item WHERE building_id = '${B.condo}'`)).toEqual(
        [],
      );
      expect(await ids(T.aptB, 'SELECT id FROM core.building')).toEqual([B.aptB, B.condo].sort());
    });

    it('a read grant does not answer for write access (0009)', async () => {
      const probe = async (module: string, access: string) => {
        let out: string[] = [];
        await as<{ id: string }>(T.aptB, async (q) => {
          out = (await q(`SELECT unnest(core.accessible_building_ids($1, $2)) AS id`, [module, access])).map(
            (r) => r.id,
          );
        });
        return out;
      };
      expect(await probe('smart.metering', 'read')).toContain(B.condo);
      expect(await probe('smart.metering', 'write')).not.toContain(B.condo);
      expect(await probe('ops.billing', 'read')).not.toContain(B.condo);
      // the landlord's unit grant is a write grant
      let units: string[] = [];
      await as<{ id: string }>(T.landlord, async (q) => {
        units = (await q(`SELECT unnest(core.accessible_unit_ids('ops.lease', 'write')) AS id`)).map(
          (r) => r.id,
        );
      });
      expect(units).toHaveLength(1);
    });

    it('expired and revoked grants show nothing', async () => {
      await db.admin.query(
        `INSERT INTO core.asset_access_grant (tenant_id, grantee_tenant_id, building_id, scope, modules, reason, valid_from, valid_to)
         VALUES ($1, $2, $3, 'building', '{*}', 'support_other', now() - interval '2 days', now() - interval '1 day')`,
        [T.aptA, T.aptB, B.aptA],
      );
      expect(await ids(T.aptB, `SELECT id FROM core.unit WHERE building_id = '${B.aptA}'`)).toEqual([]);
      // the same grant while valid …
      const { rows } = await db.admin.query<{ id: string }>(
        `INSERT INTO core.asset_access_grant (tenant_id, grantee_tenant_id, building_id, scope, modules, reason, valid_from)
         VALUES ($1, $2, $3, 'building', '{*}', 'support_other', now() - interval '1 hour') RETURNING id`,
        [T.aptA, T.aptB, B.aptA],
      );
      expect(await ids(T.aptB, `SELECT id FROM core.unit WHERE building_id = '${B.aptA}'`)).toEqual([
        U.aptA1,
      ]);
      // … and after it is revoked
      await db.admin.query(
        `UPDATE core.asset_access_grant SET revoked_at = now(), revoked_by = $2 WHERE id = $1`,
        [rows[0]!.id, USER],
      );
      expect(await ids(T.aptB, `SELECT id FROM core.unit WHERE building_id = '${B.aptA}'`)).toEqual([]);
    });

    it('only the owner or operator of a building may grant access to it', async () => {
      await expect(
        as(T.aptB, (q) =>
          q(
            `INSERT INTO core.asset_access_grant (tenant_id, grantee_tenant_id, building_id, scope, modules, reason)
             VALUES ($1, $2, $3, 'building', '{*}', 'contractor')`,
            [T.aptB, T.landlord, B.aptA],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('grantor and grantee see the grant, nobody else', async () => {
      expect((await ids(T.landlord, 'SELECT id FROM core.asset_access_grant')).length).toBe(1);
      expect((await ids(T.juristic, 'SELECT id FROM core.asset_access_grant')).length).toBe(1);
      expect(
        await ids(T.aptA, `SELECT id FROM core.asset_access_grant WHERE grantee_tenant_id = '${T.landlord}'`),
      ).toEqual([]);
    });

    it('grantees never write core.asset rows', async () => {
      await expect(
        as(T.landlord, (q) =>
          q(`UPDATE core.unit SET title_deed_no = 'x' WHERE id = $1 RETURNING id`, [U.condo1]),
        ),
      ).resolves.toBeDefined();
      const { rows } = await db.admin.query(`SELECT title_deed_no FROM core.unit WHERE id = $1`, [U.condo1]);
      expect(rows[0]).toEqual({ title_deed_no: null });
    });
  });

  it('gp_app cannot read data keys directly; core.tenant_dek() returns only the current tenant’s key', async () => {
    await expect(as(T.aptA, (q) => q('SELECT * FROM core.tenant_data_key'))).rejects.toThrow(
      /permission denied/,
    );
    let keys: { kek_ref: string }[] = [];
    await as<{ kek_ref: string }>(T.aptA, async (q) => {
      keys = await q('SELECT kek_ref FROM core.tenant_dek()');
    });
    expect(keys).toEqual([{ kek_ref: 'kms://fake/a' }]);
  });

  it('a user sees only its own account (identity lookups run as gp_platform)', async () => {
    expect(await ids(T.aptA, 'SELECT id FROM core.user_account')).toEqual([]);
    expect(await ids(T.aptA, 'SELECT id FROM core.user_account', { actorId: USER })).toEqual([USER]);
  });

  it('gp_reporting reads under RLS and cannot write', async () => {
    expect(await ids(T.aptA, 'SELECT id FROM core.unit', { role: 'gp_reporting' })).toEqual([U.aptA1]);
    await expect(
      as(T.aptA, (q) => q(`UPDATE core.unit SET title_deed_no = 'x' WHERE id = $1`, [U.aptA1]), {
        role: 'gp_reporting',
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(T.aptA, (q) => q('SELECT kid FROM core.tenant_dek()'), { role: 'gp_reporting' }),
    ).rejects.toThrow(/permission denied/);
  });

  it('gp_platform bypasses RLS (admin surface, cross-tenant jobs)', async () => {
    await db.admin.query('BEGIN');
    try {
      await db.admin.query('SET LOCAL ROLE gp_platform');
      const { rows } = await db.admin.query('SELECT count(*)::int AS n FROM core.unit');
      expect(rows[0]).toEqual({ n: 4 });
    } finally {
      await db.admin.query('ROLLBACK');
    }
  });

  describe('external stubs (0.5.0, D-251)', () => {
    const L2 = '0199f1c2-0000-7000-8000-00000000001e';
    const STUB = '0199f1c2-0001-7000-8000-00000000000f';
    const STUB_PROP = '0199f1c2-0005-7000-8000-00000000000f';
    const S1 = '0199f1c2-0002-7000-8000-0000000000f1';
    const S2 = '0199f1c2-0002-7000-8000-0000000000f2';
    beforeAll(async () => {
      await db.admin.query(`
        INSERT INTO core.tenant (id, type, slug, display_name, legal_name, legal_form) VALUES
          ('${L2}', 'landlord', 'landlord-2', 'Landlord 2', 'Landlord Two', 'person');
        INSERT INTO core.property (id, tenant_id, code, name) VALUES ('${STUB_PROP}', '${T.landlord}', 'S', 'Stub condo');
        INSERT INTO core.building (id, tenant_id, property_id, code, name, type, owner_tenant_id, operator_tenant_id, status)
          VALUES ('${STUB}', '${T.landlord}', '${STUB_PROP}', 'S', 'Stub condo', 'condo', NULL, NULL, 'external');
        INSERT INTO core.unit (id, tenant_id, building_id, property_id, unit_no, type) VALUES
          ('${S1}', '${T.landlord}', '${STUB}', '${STUB_PROP}', '12/1', 'condo_unit'),
          ('${S2}', '${L2}', '${STUB}', '${STUB_PROP}', '12/2', 'condo_unit');
      `);
    });

    it('only an external stub may have no operator', async () => {
      await expect(
        db.admin.query(
          `INSERT INTO core.building (tenant_id, property_id, code, name, type, operator_tenant_id)
           VALUES ('${T.landlord}', '${STUB_PROP}', 'X', 'No operator', 'house', NULL)`,
        ),
      ).rejects.toThrow(/building_operator_required_check/);
    });

    it('two landlords in one stub condo both see the stub and its property, and only their own units', async () => {
      expect(await ids(T.landlord, `SELECT id FROM core.building WHERE id = '${STUB}'`)).toEqual([STUB]);
      expect(await ids(L2, `SELECT id FROM core.building WHERE id = '${STUB}'`)).toEqual([STUB]);
      expect(await ids(L2, `SELECT id FROM core.property WHERE id = '${STUB_PROP}'`)).toEqual([STUB_PROP]);
      expect(await ids(T.landlord, `SELECT id FROM core.unit WHERE building_id = '${STUB}'`)).toEqual([S1]);
      expect(await ids(L2, `SELECT id FROM core.unit WHERE building_id = '${STUB}'`)).toEqual([S2]);
      // a third tenant sees nothing of the stub
      expect(await ids(T.aptA, `SELECT id FROM core.building WHERE id = '${STUB}'`)).toEqual([]);
    });

    it('a landlord adds its unit to a stub created by another landlord but cannot edit the stub', async () => {
      await as(L2, async (q) => {
        await q(
          `INSERT INTO core.unit (tenant_id, building_id, property_id, unit_no, type)
           VALUES ('${L2}', '${STUB}', '${STUB_PROP}', '12/3', 'condo_unit')`,
        );
        const updated = await q(
          `UPDATE core.building SET name = 'Renamed' WHERE id = '${STUB}' RETURNING id`,
        );
        expect(updated).toEqual([]);
      });
    });
  });

  it('the parties of another tenant stay invisible even through a unit grant', async () => {
    expect(await ids(T.landlord, 'SELECT id FROM core.party')).toEqual([P.occupantCondo1]);
  });
});
