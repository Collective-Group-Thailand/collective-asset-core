import type { GrantAccess, GrantReason } from './enums.js';

/**
 * The `core.asset_access_grant` rule set (D-153, schema-design v2 §3.1.5 and §4.5). Module keys name the
 * row families a grant opens; `'*'` opens all of them. The database enforces the key list
 * (asset_access_grant_modules_check) and the read/write split in the RLS policies; this file is the shared
 * vocabulary for apps (getproperty-api, getbuild-api) and is kept in sync by `test/grant-rules.test.ts`.
 */
export const GRANT_MODULES = [
  'core.asset',
  'core.occupancy',
  'ops.lease',
  'ops.billing',
  'ops.service',
  'ops.community',
  'smart.metering',
  'smart.access',
  'juristic',
  'warranty',
  '*',
] as const;
export type GrantModule = (typeof GRANT_MODULES)[number];

/**
 * Which module key the RLS policy of each core table checks (`any` = a grant for any module is enough).
 * Occupancy is also visible to `ops.lease` grants: a landlord leasing its unit sees who lives there.
 */
export const CORE_TABLE_GRANT_MODULE = {
  building: 'any',
  building_operator_period: 'any',
  floor: 'any',
  unit: 'any',
  unit_ownership: 'core.asset',
  occupancy: 'core.occupancy',
  asset_item: 'core.asset',
  meter_assignment: 'smart.metering',
} as const;

/**
 * Modules a grantee may *write* with `access = 'write'` (rows stamped with the grantee's own tenant_id,
 * §4.5). `core.asset` is never writable by a grantee: buildings, units and asset items change only through
 * their owner or operator.
 */
export const GRANTEE_WRITABLE_MODULES: readonly GrantModule[] = [
  'ops.lease',
  'ops.billing',
  'ops.service',
  'ops.community',
  'smart.metering',
  'smart.access',
  'juristic',
  'warranty',
];

/** Grant reasons that may carry `access = 'write'`; the others are read-only by policy of the services. */
export const WRITE_GRANT_REASONS: readonly GrantReason[] = [
  'pm_contract',
  'landlord_unit',
  'contractor',
  'developer_post_sale',
  'warranty',
  'juristic_handover',
];

export interface GrantCheck {
  modules: readonly string[];
  access: GrantAccess;
  reason: GrantReason;
}

/** Validates a grant before it is written; returns the list of problems (empty = valid). */
export function validateGrant(grant: GrantCheck): string[] {
  const problems: string[] = [];
  if (grant.modules.length === 0) problems.push('modules must not be empty');
  for (const m of grant.modules) {
    if (!(GRANT_MODULES as readonly string[]).includes(m)) problems.push(`unknown module key "${m}"`);
  }
  if (grant.access === 'write') {
    if (!WRITE_GRANT_REASONS.includes(grant.reason)) {
      problems.push(`reason "${grant.reason}" cannot grant write access`);
    }
    for (const m of grant.modules) {
      if (m === 'core.asset') problems.push('core.asset is never writable by a grantee');
    }
  }
  return problems;
}

/** True when a grant with these modules/access covers `module` at `wanted` access (mirrors the SQL helper). */
export function grantCovers(
  grant: Pick<GrantCheck, 'modules' | 'access'>,
  module: string,
  wanted: GrantAccess = 'read',
): boolean {
  const moduleOk = module === 'any' || grant.modules.includes(module) || grant.modules.includes('*');
  const accessOk = wanted === 'read' || grant.access === 'write';
  return moduleOk && accessOk;
}
