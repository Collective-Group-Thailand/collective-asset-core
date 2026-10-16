import type pg from 'pg';

/** Deterministic fake ids (uuidv7-shaped) for the RLS matrix. */
export const T = {
  aptA: '0199f1c2-0000-7000-8000-00000000000a',
  aptB: '0199f1c2-0000-7000-8000-00000000000b',
  juristic: '0199f1c2-0000-7000-8000-00000000000c',
  pm: '0199f1c2-0000-7000-8000-00000000000d',
  landlord: '0199f1c2-0000-7000-8000-00000000000e',
} as const;

export const B = {
  aptA: '0199f1c2-0001-7000-8000-00000000000a',
  aptB: '0199f1c2-0001-7000-8000-00000000000b',
  condo: '0199f1c2-0001-7000-8000-00000000000c',
} as const;

export const U = {
  aptA1: '0199f1c2-0002-7000-8000-0000000000a1',
  aptB1: '0199f1c2-0002-7000-8000-0000000000b1',
  condo1: '0199f1c2-0002-7000-8000-0000000000c1',
  condo2: '0199f1c2-0002-7000-8000-0000000000c2',
} as const;

export const P = {
  landlordParty: '0199f1c2-0003-7000-8000-00000000000e',
  ownerOfCondo2: '0199f1c2-0003-7000-8000-0000000000c2',
  occupantCondo1: '0199f1c2-0003-7000-8000-0000000000c1',
  occupantCondo2: '0199f1c2-0003-7000-8000-0000000000d2',
} as const;

export const USER = '0199f1c2-0004-7000-8000-000000000001';

/**
 * Seeds (as superuser, bypassing RLS) two apartments (owner = operator), one condo whose owner is a juristic
 * tenant and whose operator is a PM company, and a landlord owning unit condo1.
 */
export async function seedRlsWorld(db: pg.Client): Promise<void> {
  await db.query(`
    INSERT INTO core.tenant (id, type, slug, display_name, legal_name, legal_form) VALUES
      ('${T.aptA}', 'apartment', 'apt-a', 'Apartment A', 'Apartment A Co.', 'company'),
      ('${T.aptB}', 'apartment', 'apt-b', 'Apartment B', 'Apartment B Co.', 'company'),
      ('${T.juristic}', 'condo_juristic', 'condo-j', 'Condo Juristic', 'Condo Juristic Person', 'juristic_person'),
      ('${T.pm}', 'pm_company', 'pm-co', 'PM Co', 'PM Company Ltd.', 'company'),
      ('${T.landlord}', 'landlord', 'landlord', 'Landlord', 'Landlord Person', 'person');
    INSERT INTO core.property (id, tenant_id, code, name) VALUES
      ('0199f1c2-0005-7000-8000-00000000000a', '${T.aptA}', 'P-A', 'Property A'),
      ('0199f1c2-0005-7000-8000-00000000000b', '${T.aptB}', 'P-B', 'Property B'),
      ('0199f1c2-0005-7000-8000-00000000000c', '${T.pm}', 'P-C', 'Condo property');
    INSERT INTO core.building (id, tenant_id, property_id, code, name, type, owner_tenant_id, operator_tenant_id) VALUES
      ('${B.aptA}', '${T.aptA}', '0199f1c2-0005-7000-8000-00000000000a', 'A', 'Building A', 'apartment', '${T.aptA}', '${T.aptA}'),
      ('${B.aptB}', '${T.aptB}', '0199f1c2-0005-7000-8000-00000000000b', 'B', 'Building B', 'apartment', '${T.aptB}', '${T.aptB}'),
      ('${B.condo}', '${T.juristic}', '0199f1c2-0005-7000-8000-00000000000c', 'C', 'Condo', 'condo', '${T.juristic}', '${T.pm}');
    INSERT INTO core.unit (id, tenant_id, building_id, property_id, unit_no, type) VALUES
      ('${U.aptA1}', '${T.aptA}', '${B.aptA}', '0199f1c2-0005-7000-8000-00000000000a', 'A-101', 'room'),
      ('${U.aptB1}', '${T.aptB}', '${B.aptB}', '0199f1c2-0005-7000-8000-00000000000b', 'B-101', 'room'),
      ('${U.condo1}', '${T.juristic}', '${B.condo}', '0199f1c2-0005-7000-8000-00000000000c', 'C-101', 'condo_unit'),
      ('${U.condo2}', '${T.juristic}', '${B.condo}', '0199f1c2-0005-7000-8000-00000000000c', 'C-102', 'condo_unit');
    INSERT INTO core.party (id, tenant_id, type, display_name) VALUES
      ('${P.landlordParty}', '${T.juristic}', 'person', 'Landlord (co-owner record)'),
      ('${P.ownerOfCondo2}', '${T.juristic}', 'person', 'Owner of C-102'),
      ('${P.occupantCondo1}', '${T.landlord}', 'person', 'Lessee of C-101'),
      ('${P.occupantCondo2}', '${T.juristic}', 'person', 'Occupant of C-102');
    INSERT INTO core.unit_ownership (tenant_id, building_id, unit_id, party_id, share_pct, valid_from) VALUES
      ('${T.juristic}', '${B.condo}', '${U.condo1}', '${P.landlordParty}', 100, '2026-01-01'),
      ('${T.juristic}', '${B.condo}', '${U.condo2}', '${P.ownerOfCondo2}', 100, '2026-01-01');
    INSERT INTO core.occupancy (tenant_id, building_id, unit_id, party_id, role, valid_from) VALUES
      ('${T.landlord}', '${B.condo}', '${U.condo1}', '${P.occupantCondo1}', 'tenant', '2026-02-01'),
      ('${T.juristic}', '${B.condo}', '${U.condo2}', '${P.occupantCondo2}', 'owner_occupier', '2026-01-01');
    INSERT INTO core.asset_item (id, tenant_id, building_id, unit_id, category, name) VALUES
      ('0199f1c2-0006-7000-8000-0000000000c1', '${T.juristic}', '${B.condo}', '${U.condo1}', 'meter_electric', 'Meter C-101');
    INSERT INTO core.meter_assignment (tenant_id, building_id, asset_item_id, unit_id, purpose, utility, code, valid_from) VALUES
      ('${T.juristic}', '${B.condo}', '0199f1c2-0006-7000-8000-0000000000c1', '${U.condo1}', 'unit', 'electric', 'C-101E', '2026-01-01T00:00:00Z');
    INSERT INTO core.user_account (id, display_name, phone_e164) VALUES ('${USER}', 'Owner user', '+66800000001');
    INSERT INTO core.tenant_data_key (tenant_id, kid, wrapped_dek, kek_ref) VALUES
      ('${T.aptA}', 1, '\\x0a0a', 'kms://fake/a'), ('${T.aptB}', 1, '\\x0b0b', 'kms://fake/b');
  `);
}
