import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assetCoreMigrate } from '../src/migrate.js';
import { withTenant } from '../src/tenant-scope.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';
import { B, seedRlsWorld, T } from './support/fixtures.js';

const AGENCY = '0199f1c2-0000-7000-8000-0000000000a9';
const HELD_UNIT = '0199f1c2-0002-7000-8000-0000000000e1';
const DOC = '0199f1c2-0007-7000-8000-0000000000d1';

/**
 * 0013 (0.7.0): agency tenants, listing-mandate grants by the tenant holding a unit row (a landlord's unit in a
 * building it neither owns nor operates) and the generic legal-hold guard on documents.
 */
describe('agency mandates and the legal-hold guard (0013)', () => {
  let db: TestDatabase;
  const as = (tenantId: string, sql: string, params: unknown[] = []) =>
    withTenant(db.admin, tenantId, async (c) => (await c.query(sql, params)).rows, { role: 'gp_app' });

  beforeAll(async () => {
    db = await createTestDatabase('ac_agency');
    await assetCoreMigrate({ client: db.admin });
    await seedRlsWorld(db.admin);
    await db.admin.query(
      `INSERT INTO core.tenant (id, type, slug, display_name, legal_name, legal_form)
       VALUES ($1, 'agency', 'agency', 'Agency', 'Agency Co.', 'company')`,
      [AGENCY],
    );
    // the landlord holds a unit row in the juristic person's condo (it neither owns nor operates the building)
    await db.admin.query(
      `INSERT INTO core.unit (id, tenant_id, building_id, property_id, unit_no, type)
       VALUES ($1, $2, $3, '0199f1c2-0005-7000-8000-00000000000c', 'C-201', 'condo_unit')`,
      [HELD_UNIT, T.landlord, B.condo],
    );
  });
  afterAll(async () => {
    await db.drop();
  });

  const grant = (reason: string, modules: string, unit: string | null = HELD_UNIT) =>
    as(
      T.landlord,
      `INSERT INTO core.asset_access_grant (tenant_id, grantee_tenant_id, building_id, unit_id, scope, modules, reason)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7::core.grant_reason) RETURNING id`,
      [T.landlord, AGENCY, B.condo, unit, unit ? 'unit' : 'building', modules, reason],
    );

  it('the unit holder mandates an agency for its unit; the agency sees that unit, not the building', async () => {
    expect(await as(AGENCY, 'SELECT id FROM core.unit')).toEqual([]);
    await grant('listing_mandate', '{ops.listing,ops.lease}');
    expect(await as(AGENCY, 'SELECT id FROM core.unit')).toEqual([{ id: HELD_UNIT }]);
    expect(await as(AGENCY, 'SELECT id FROM core.building')).toEqual([]);
    expect(await as(AGENCY, 'SELECT id FROM core.tenant')).toEqual([{ id: AGENCY }]);
  });

  it('a unit holder may not grant other reasons, core modules, the building or a unit it does not hold', async () => {
    await expect(grant('landlord_unit', '{ops.listing}')).rejects.toThrow(/row-level security/);
    await expect(grant('listing_mandate', '{core.occupancy}')).rejects.toThrow(/row-level security/);
    await expect(grant('listing_mandate', '{*}')).rejects.toThrow(/row-level security/);
    await expect(grant('listing_mandate', '{ops.listing}', null)).rejects.toThrow(/row-level security/);
    await expect(
      as(
        T.landlord,
        `INSERT INTO core.asset_access_grant (tenant_id, grantee_tenant_id, building_id, unit_id, scope, modules, reason)
         VALUES ($1, $2, $3, '0199f1c2-0002-7000-8000-0000000000c2', 'unit', '{ops.listing}', 'listing_mandate')`,
        [T.landlord, AGENCY, B.condo],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('the building owner still grants as before; ops.listing is a valid module key', async () => {
    await as(
      T.juristic,
      `INSERT INTO core.asset_access_grant (tenant_id, grantee_tenant_id, building_id, unit_id, scope, modules, reason)
       VALUES ($1, $2, $3, '0199f1c2-0002-7000-8000-0000000000c2', 'unit', '{ops.listing}', 'listing_mandate')`,
      [T.juristic, AGENCY, B.condo],
    );
    expect((await as(AGENCY, 'SELECT id FROM core.unit')).length).toBe(2);
    await expect(
      db.admin.query(
        `INSERT INTO core.asset_access_grant (tenant_id, grantee_tenant_id, building_id, scope, modules, reason)
         VALUES ($1, $2, $3, 'building', '{ops.listings}', 'contractor')`,
        [T.juristic, AGENCY, B.condo],
      ),
    ).rejects.toThrow(/asset_access_grant_modules_check/);
  });

  it('a held document cannot be soft- or hard-deleted while the hold is in force', async () => {
    await db.admin.query(
      `INSERT INTO core.document (id, tenant_id, scope_type, kind, storage_bucket, storage_key, mime_type, size_bytes,
                                  sha256, retention_class, legal_hold)
       VALUES ($1, $2, 'tenant', 'other', 'b', 'k/held.pdf', 'application/pdf', 10, decode(repeat('ab', 32), 'hex'),
               'legal', true)`,
      [DOC, T.landlord],
    );
    await expect(
      as(T.landlord, `UPDATE core.document SET deleted_at = now() WHERE id = $1`, [DOC]),
    ).rejects.toThrow(/core\.legal_hold/);
    await expect(db.admin.query(`DELETE FROM core.document WHERE id = $1`, [DOC])).rejects.toThrow(
      /core\.legal_hold/,
    );
    // other updates pass; a hold that ended no longer guards
    await as(T.landlord, `UPDATE core.document SET title = 'Receipt' WHERE id = $1`, [DOC]);
    await expect(
      db.admin.query(`UPDATE core.document SET legal_hold_until = now() + interval '1 day' WHERE id = $1`, [
        DOC,
      ]),
    ).resolves.toBeDefined();
    await expect(
      db.admin.query(`UPDATE core.document SET deleted_at = now() WHERE id = $1`, [DOC]),
    ).rejects.toThrow(/core\.legal_hold/);
    await db.admin.query(
      `UPDATE core.document SET legal_hold_until = now() - interval '1 second' WHERE id = $1`,
      [DOC],
    );
    await as(T.landlord, `UPDATE core.document SET deleted_at = now() WHERE id = $1`, [DOC]);
    await expect(
      db.admin.query(`UPDATE core.document SET legal_hold = false, legal_hold_until = now() WHERE id = $1`, [
        DOC,
      ]),
    ).rejects.toThrow(/document_legal_hold_check/);
    await db.admin.query(
      `UPDATE core.document SET legal_hold = false, legal_hold_until = NULL WHERE id = $1`,
      [DOC],
    );
    await db.admin.query(`DELETE FROM core.document WHERE id = $1`, [DOC]);
  });
});
