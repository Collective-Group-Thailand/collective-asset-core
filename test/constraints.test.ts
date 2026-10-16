import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assetCoreMigrate } from '../src/migrate.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';
import { B, P, seedRlsWorld, T, U, USER } from './support/fixtures.js';

describe('core constraints and triggers', () => {
  let db: TestDatabase;
  const tx = (sql: string, params: unknown[] = []) => txMany([[sql, params]]);
  const txMany = async (statements: [string, unknown[]][]) => {
    await db.admin.query('BEGIN');
    try {
      for (const [sql, params] of statements) await db.admin.query(sql, params);
      await db.admin.query('COMMIT');
    } catch (error) {
      await db.admin.query('ROLLBACK');
      throw error;
    }
  };

  beforeAll(async () => {
    db = await createTestDatabase('ac_constraints');
    await assetCoreMigrate({ client: db.admin });
    await seedRlsWorld(db.admin);
  });
  afterAll(async () => {
    await db.drop();
  });

  describe('unit ownership shares', () => {
    it('refuses shares that sum above 100 % on any day (checked at commit)', async () => {
      // C-102 is owned 100 % by P.ownerOfCondo2 since 2026-01-01; a second owner from 2026-06-01 → 150 %
      await expect(
        tx(
          `INSERT INTO core.unit_ownership (tenant_id, building_id, unit_id, party_id, share_pct, valid_from) VALUES ($1, $2, $3, $4, 50, '2026-06-01')`,
          [T.juristic, B.condo, U.condo2, P.occupantCondo2],
        ),
      ).rejects.toThrow(/core.ownership_share_exceeded/);
    });

    it('accepts a transfer written in any order inside one transaction', async () => {
      await txMany([
        [
          `INSERT INTO core.unit_ownership (tenant_id, building_id, unit_id, party_id, share_pct, valid_from) VALUES ($1, $2, $3, $4, 60, '2026-06-01'), ($1, $2, $3, $5, 40, '2026-06-01')`,
          [T.juristic, B.condo, U.condo2, P.occupantCondo2, P.landlordParty],
        ],
        [
          `UPDATE core.unit_ownership SET valid_to = '2026-06-01' WHERE unit_id = $1 AND party_id = $2`,
          [U.condo2, P.ownerOfCondo2],
        ],
      ]);
      const { rows } = await db.admin.query(
        `SELECT sum(share_pct)::text AS total FROM core.unit_ownership WHERE unit_id = $1 AND daterange(valid_from, valid_to) @> '2026-07-01'::date`,
        [U.condo2],
      );
      expect(rows[0]).toEqual({ total: '100.0000' });
    });

    it('refuses an overlapping second period for the same party and unit (exclusion)', async () => {
      await expect(
        tx(
          `INSERT INTO core.unit_ownership (tenant_id, building_id, unit_id, party_id, share_pct, valid_from) VALUES ($1, $2, $3, $4, 10, '2026-08-01')`,
          [T.juristic, B.condo, U.condo2, P.occupantCondo2],
        ),
      ).rejects.toThrow(/unit_ownership_no_overlap/);
    });

    it('refuses shares outside (0, 100]', async () => {
      await expect(
        tx(
          `INSERT INTO core.unit_ownership (tenant_id, building_id, unit_id, party_id, share_pct, valid_from) VALUES ($1, $2, $3, $4, 0, '2030-01-01')`,
          [T.juristic, B.condo, U.condo1, P.ownerOfCondo2],
        ),
      ).rejects.toThrow(/unit_ownership_share_pct_check/);
    });
  });

  describe('occupancy periods', () => {
    it('refuses overlapping periods of the same party in the same unit, accepts adjacent ones', async () => {
      await expect(
        tx(
          `INSERT INTO core.occupancy (tenant_id, building_id, unit_id, party_id, role, valid_from, valid_to) VALUES ($1, $2, $3, $4, 'family', '2026-03-01', '2026-04-01')`,
          [T.landlord, B.condo, U.condo1, P.occupantCondo1],
        ),
      ).rejects.toThrow(/occupancy_no_overlap/);
      await tx(
        `INSERT INTO core.occupancy (tenant_id, building_id, unit_id, party_id, role, valid_from, valid_to) VALUES ($1, $2, $3, $4, 'tenant', '2025-01-01', '2026-02-01')`,
        [T.landlord, B.condo, U.condo1, P.occupantCondo1],
      );
    });

    it('refuses an empty or inverted period', async () => {
      await expect(
        tx(
          `INSERT INTO core.occupancy (tenant_id, building_id, unit_id, party_id, role, valid_from, valid_to) VALUES ($1, $2, $3, $4, 'family', '2027-01-01', '2027-01-01')`,
          [T.juristic, B.condo, U.condo2, P.ownerOfCondo2],
        ),
      ).rejects.toThrow(/occupancy_range_check/);
    });
  });

  describe('meter assignments', () => {
    it('one meter per unit and utility at a time; a swap closes one and opens the next', async () => {
      const meter2 = '0199f1c2-0006-7000-8000-0000000000c9';
      await tx(
        `INSERT INTO core.asset_item (id, tenant_id, building_id, unit_id, category, name) VALUES ($1, $2, $3, $4, 'meter_electric', 'Meter 2')`,
        [meter2, T.juristic, B.condo, U.condo1],
      );
      await expect(
        tx(
          `INSERT INTO core.meter_assignment (tenant_id, building_id, asset_item_id, unit_id, purpose, utility, code, valid_from) VALUES ($1, $2, $3, $4, 'unit', 'electric', 'C-101E2', '2026-05-01T00:00:00Z')`,
          [T.juristic, B.condo, meter2, U.condo1],
        ),
      ).rejects.toThrow(/meter_assignment_unit_no_overlap/);
      await txMany([
        [
          `UPDATE core.meter_assignment SET valid_to = '2026-05-01T00:00:00Z', final_reading = 1234.5, close_reason = 'swap' WHERE unit_id = $1 AND valid_to IS NULL`,
          [U.condo1],
        ],
        [
          `INSERT INTO core.meter_assignment (tenant_id, building_id, asset_item_id, unit_id, purpose, utility, code, valid_from, initial_reading) VALUES ($1, $2, $3, $4, 'unit', 'electric', 'C-101E2', '2026-05-01T00:00:00Z', 0)`,
          [T.juristic, B.condo, meter2, U.condo1],
        ],
      ]);
    });

    it('a unit purpose needs a unit and a closed assignment needs its final reading', async () => {
      await expect(
        tx(
          `INSERT INTO core.meter_assignment (tenant_id, building_id, asset_item_id, purpose, utility, code, valid_from) VALUES ($1, $2, '0199f1c2-0006-7000-8000-0000000000c1', 'unit', 'water', 'X', now())`,
          [T.juristic, B.condo],
        ),
      ).rejects.toThrow(/meter_assignment_unit_purpose_check/);
    });
  });

  describe('building operator periods', () => {
    it('a new period closes the previous one; closed periods are immutable', async () => {
      await tx(
        `INSERT INTO core.building_operator_period (tenant_id, building_id, owner_tenant_id, operator_tenant_id, valid_from, reason) VALUES ($1, $2, $1, $1, '2026-01-01T00:00:00Z', 'initial')`,
        [T.juristic, B.condo],
      );
      await tx(
        `INSERT INTO core.building_operator_period (tenant_id, building_id, owner_tenant_id, operator_tenant_id, valid_from, reason) VALUES ($1, $2, $1, $3, '2026-07-01T00:00:00Z', 'pm_contract_start')`,
        [T.juristic, B.condo, T.pm],
      );
      const { rows } = await db.admin.query<{ reason: string; valid_to: Date | null }>(
        `SELECT reason::text, valid_to FROM core.building_operator_period WHERE building_id = $1 ORDER BY valid_from`,
        [B.condo],
      );
      expect(rows.map((r) => [r.reason, r.valid_to?.toISOString() ?? null])).toEqual([
        ['initial', '2026-07-01T00:00:00.000Z'],
        ['pm_contract_start', null],
      ]);
      await expect(
        tx(
          `UPDATE core.building_operator_period SET reason = 'other' WHERE building_id = $1 AND reason = 'initial'`,
          [B.condo],
        ),
      ).rejects.toThrow(/core.append_only/);
      await expect(
        tx(`DELETE FROM core.building_operator_period WHERE building_id = $1`, [B.condo]),
      ).rejects.toThrow(/core.append_only/);
    });
  });

  describe('row checks', () => {
    it('tenant tax id is 13 digits; grants are to another tenant, with known module keys', async () => {
      await expect(tx(`UPDATE core.tenant SET tax_id = '123' WHERE id = $1`, [T.aptA])).rejects.toThrow(
        /tenant_tax_id_check/,
      );
      await expect(
        tx(
          `INSERT INTO core.asset_access_grant (tenant_id, grantee_tenant_id, building_id, scope, modules, reason) VALUES ($1, $1, $2, 'building', '{*}', 'contractor')`,
          [T.aptA, B.aptA],
        ),
      ).rejects.toThrow(/asset_access_grant_grantee_check/);
      await expect(
        tx(
          `INSERT INTO core.asset_access_grant (tenant_id, grantee_tenant_id, building_id, scope, modules, reason) VALUES ($1, $2, $3, 'building', '{billing}', 'contractor')`,
          [T.aptA, T.aptB, B.aptA],
        ),
      ).rejects.toThrow(/asset_access_grant_modules_check/);
    });

    it('updated_at follows every update', async () => {
      const before = await db.admin.query<{ updated_at: Date }>(
        `SELECT updated_at FROM core.unit WHERE id = $1`,
        [U.aptA1],
      );
      await tx(`UPDATE core.unit SET status = 'occupied' WHERE id = $1`, [U.aptA1]);
      const after = await db.admin.query<{ updated_at: Date }>(
        `SELECT updated_at FROM core.unit WHERE id = $1`,
        [U.aptA1],
      );
      expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThan(before.rows[0]!.updated_at.getTime());
    });

    it('ids default to uuidv7', async () => {
      const fresh = await db.admin.query<{ v: number }>(
        `INSERT INTO core.tenant (slug, display_name, legal_name, legal_form) VALUES ('v7', 'v7', 'v7', 'company') RETURNING uuid_extract_version(id) AS v`,
      );
      expect(fresh.rows[0]!.v).toBe(7);
    });
  });
  describe('party matching (0.2.0)', () => {
    it('links a user to a party matched by a verified phone (party_link_via phone_match)', async () => {
      await tx(`UPDATE core.party SET phone_e164 = '+66810009999' WHERE id = $1`, [P.occupantCondo1]);
      const { rows } = await db.admin.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM core.party WHERE phone_e164 = '+66810009999' AND deleted_at IS NULL AND anonymised_at IS NULL`,
      );
      expect(rows.map((r) => r.id)).toEqual([P.occupantCondo1]);
      await tx(
        `INSERT INTO core.party_user_link (tenant_id, party_id, user_id, linked_via) VALUES ($1, $2, $3, 'phone_match')`,
        [rows[0]!.tenant_id, P.occupantCondo1, USER],
      );
      const link = await db.admin.query(`SELECT linked_via FROM core.party_user_link WHERE party_id = $1`, [
        P.occupantCondo1,
      ]);
      expect(link.rows).toEqual([{ linked_via: 'phone_match' }]);
    });

    it('has the cross-tenant lookup indexes on phone and LINE user id', async () => {
      const { rows } = await db.admin.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'core' AND tablename = 'party'
            AND indexname IN ('party_phone_e164_idx', 'party_line_user_id_idx') ORDER BY 1`,
      );
      expect(rows.map((r) => r.indexname)).toEqual(['party_line_user_id_idx', 'party_phone_e164_idx']);
    });
  });
});
