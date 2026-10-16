import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GRANT_MODULES, grantCovers, validateGrant } from '../src/grant-rules.js';

describe('grant rule set', () => {
  it('the module keys equal the database CHECK list', () => {
    const sql = readFileSync(join(import.meta.dirname, '..', 'migrations', '0007_grants_rls.sql'), 'utf8');
    const list = /modules <@ ARRAY\[([^\]]+)\]/.exec(sql)?.[1] ?? '';
    const keys = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...GRANT_MODULES].sort());
  });

  it('validates grants', () => {
    expect(
      validateGrant({ modules: ['ops.lease', 'ops.billing'], access: 'write', reason: 'landlord_unit' }),
    ).toEqual([]);
    expect(validateGrant({ modules: ['core.asset'], access: 'write', reason: 'pm_contract' })).toContain(
      'core.asset is never writable by a grantee',
    );
    expect(validateGrant({ modules: ['ops.lease'], access: 'write', reason: 'owner_portal' })).toContain(
      'reason "owner_portal" cannot grant write access',
    );
    expect(validateGrant({ modules: [], access: 'read', reason: 'contractor' })).toContain(
      'modules must not be empty',
    );
    expect(validateGrant({ modules: ['billing'], access: 'read', reason: 'contractor' })).toContain(
      'unknown module key "billing"',
    );
  });

  it('mirrors the SQL coverage rule', () => {
    expect(grantCovers({ modules: ['*'], access: 'read' }, 'ops.lease')).toBe(true);
    expect(grantCovers({ modules: ['ops.lease'], access: 'read' }, 'ops.billing')).toBe(false);
    expect(grantCovers({ modules: ['ops.lease'], access: 'read' }, 'ops.lease', 'write')).toBe(false);
    expect(grantCovers({ modules: ['ops.lease'], access: 'write' }, 'any', 'write')).toBe(true);
  });
});
