# @collective/asset-core

The shared **asset core** of Collective Group products (getproperty, getbuild): the PostgreSQL schema `core`
(tenancy, identity, property → building → floor → unit, parties, ownership, occupancy, asset items, meter
assignments, documents, cross-tenant grants), its SQL migrations and runner, a Prisma fragment, TypeScript
enums and row types, the tenant-scope session helper, the field-encryption envelope and the zod **integration
event contracts**. Decisions: D-152, D-153 (`docs/decisions.md`), ADR-0009, ADR-0010 (`docs/adr/`).
Each product keeps **its own database**; they share the schema definition and the event contracts, not rows.

Version **0.3.0** = the 18 tables of schema-design v2 §7.1 (getproperty-api `docs/schema-design.md`) plus the
additive 0.2.0 migration for resident party matching (`party_link_via.phone_match`, cross-tenant phone / LINE
lookup indexes), the 0.2.1 fix of the grant `access` argument and the additive 0.3.0 migration for leases
(`document_kind.signature`, occupancy-by-lease index). See `CHANGELOG.md`.

## Contents
| Path | What |
|---|---|
| `migrations/0001…0008_*.sql` | the `core` schema: extensions (pgcrypto, citext, btree_gist, pg_trgm), `uuidv7()` guard for PG < 18, roles `gp_owner`/`gp_app`/`gp_platform`/`gp_reporting`, trigger functions, 31 enums, 18 tables with every CHECK/EXCLUDE/partial index, helper functions, RLS (ENABLE + FORCE) and grants |
| `src/migrate.ts` · `asset-core migrate` | the migration runner (`core._migration`, checksums, advisory lock) |
| `prisma/core.prisma` · `asset-core prisma-fragment` | Prisma models of the 18 tables (`@@schema("core")`) for apps' multi-file schemas |
| `src/enums.ts`, `src/types.ts` | TS mirrors of the enums and row shapes |
| `src/grant-rules.ts` | module keys of `core.asset_access_grant`, which tables check which module, write rules |
| `src/tenant-scope.ts` | `withTenant(client, tenantId, fn)` — one transaction with `SET LOCAL app.tenant_id` |
| `src/field-envelope.ts` | per-tenant AES-256-GCM field envelope + lookup hashes (§4.7) |
| `src/contracts/*` (`@collective/asset-core/contracts`) | envelope + 8 event payloads, fixtures, `parseIntegrationEvent()`, JSON Schema export (`schemas/*.json`) |
| `src/testing/*` (`@collective/asset-core/testing`) | `checkPrismaDrift()` — database catalogue vs Prisma DMMF |

## Install
```bash
# GitHub Packages (private): .npmrc → @collective:registry=https://npm.pkg.github.com
pnpm add @collective/asset-core@0.3.0
# until the registry is set up: a Git tag, or a sibling checkout during development
pnpm add github:collective-group/collective-asset-core#v0.3.0
pnpm add @collective/asset-core@link:../collective-asset-core
```
Node 24. Runtime dependencies: `pg`, `zod`.

## Migrate
Apps run the core migrations **before** their own (getproperty-api: `pnpm db:migrate` = `asset-core migrate &&
prisma migrate deploy`):
```bash
asset-core migrate --url "$DATABASE_URL"    # or DATABASE_URL in the environment; --dry-run lists pending
asset-core status  --url "$DATABASE_URL"    # applied / pending / checksum_mismatch / unknown
asset-core sql > core.sql                   # all migrations as one script (Prisma initShadowDb, psql -f)
```
```ts
import { assetCoreMigrate } from '@collective/asset-core';
await assetCoreMigrate({ databaseUrl: process.env.DATABASE_URL, log: console.log });
```
- Each migration runs in its own transaction and is recorded in `core._migration` (id, sha256 checksum,
  package version, duration). Re-running is a no-op; concurrent runners serialise on an advisory lock.
- The runner **refuses** to continue when an applied migration's SQL changed (checksum mismatch) or when the
  database knows a migration this package version does not ship (database newer than the package).
- The migrating login must be a superuser or hold `CREATEROLE` the first time (roles are created if missing) and
  becomes a member of `gp_owner` and `gp_platform` (it hands the SECURITY DEFINER helpers to `gp_platform`).
  Creating `gp_platform` with `BYPASSRLS` needs a superuser (on Cloud SQL: create the four roles once as
  `cloudsqlsuperuser`, the migration then only verifies them).

### Roles and row-level security
| Role | Use | RLS |
|---|---|---|
| `gp_owner` | owns objects, runs migrations | — |
| `gp_app` | the application (DML only) | applies to every statement |
| `gp_platform` | admin surface, identity lookups, cross-tenant jobs; owns the SECURITY DEFINER helpers | `BYPASSRLS` |
| `gp_reporting` | read-only exports/BI | applies |

Every core table has RLS **enabled and forced**. Policies key on `core.current_tenant_id()` =
`current_setting('app.tenant_id', true)`, set per transaction by `withTenant()` (or the app's own `withTx`):
- own rows: `tenant_id = current tenant`;
- buildings and everything below them are visible to the building's **owner and operator** tenants
  (`core.accessible_building_ids(module)`), and the operator writes rows stamped with the owner's tenant
  (`core.acts_for`);
- other tenants see a building or a unit only through an active `core.asset_access_grant` for the row's module
  (`'*'` = all; expired/revoked grants show nothing); only an owner/operator may grant;
- `core.user_account` is platform-only, except that a user sees its own row (`app.actor_id`);
- `core.tenant_data_key` is invisible to `gp_app`; `core.tenant_dek()` returns the current tenant's key only.

Module keys checked per table: `building`, `building_operator_period`, `floor`, `unit` → any grant;
`unit_ownership`, `asset_item` → `core.asset`; `occupancy` → `core.occupancy` or `ops.lease`;
`meter_assignment` → `smart.metering`. App tables use the same helpers with their own module keys
(`ops.billing`, `ops.lease`, …).

```ts
import pg from 'pg';
import { withTenant, configurePgTypes } from '@collective/asset-core';
configurePgTypes(pg.types); // dates as 'YYYY-MM-DD', numeric/bigint as strings (D-046)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const units = await withTenant(pool, tenantId, (c) => c.query('SELECT * FROM core.unit'), { role: 'gp_app' });
```

## Prisma
Apps include the fragment in their multi-file schema and mark the core tables as external so Prisma never
migrates them:
```bash
asset-core prisma-fragment --relations-from prisma/schema --out prisma/schema/core.prisma
```
- The output starts with a GENERATED header. `--relations-from` scans the app's `.prisma` files for relations
  **to** core models and injects the opposite fields Prisma requires into the core models (apps cannot edit
  the fragment). Such relations must be named: `tenant Tenant @relation("AuditLogTenant", fields: [tenantId], …)`
  becomes `auditLogTenant AuditLog[]` on `Tenant` (`?` when the app's FK is unique).
- The app's generator needs `previewFeatures = ["partialIndexes"]` (partial unique indexes such as
  `unit_building_id_unit_no_key … WHERE deleted_at IS NULL`) and `datasource.schemas` must list `"core"`.
- CHECK/EXCLUDE constraints, triggers, policies and functions are SQL-only.
- `checkPrismaDrift()` (`@collective/asset-core/testing`) compares a migrated database with a Prisma DMMF;
  this package's tests prove the fragment and the migrations agree.

## Integration contracts
```ts
import { parseIntegrationEvent, INTEGRATION_EVENTS, CONTRACT_FIXTURES } from '@collective/asset-core/contracts';
const event = parseIntegrationEvent(json); // discriminated union on `type`; throws ZodError
```
Envelope: `eventId` (uuidv7), `type`, `version` (payload schema version, integer), `occurredAt` (ISO with
offset), `idempotencyKey`, `sourcePlatform` (`getproperty|getbuild|getpack`), `tenantId` (producing tenant or
null), `correlationId?`, `causationId?`, `payload`. Events: `building.handover.requested`, `unit.transferred`,
`warranty.defect.reported`, `warranty.defect.closed`, `juristic.formed`, `procurement.rfq.requested`,
`procurement.order.updated`, `identity.party.linked`. Money is a decimal string with ≤ 2 decimals, files are
signed https URLs, PII travels as `{ "enc": "…" }` (Collective shared integration key). Unknown fields are
ignored. JSON Schemas for non-TS consumers: `schemas/*.json`.

## Versioning and release (D-153: additive only within a major)
- **Never edit a released migration** — add `00NN_*.sql`. The publish job fails when a migration of the previous
  tag was modified or deleted; the runner refuses edited migrations at run time.
- Within a major: new tables, nullable columns, new enum values (`ALTER TYPE … ADD VALUE`), new event types or
  optional fields. Renames/drops/type changes/required fields = new major + coordinated upgrade of both apps.
- Flow: `pnpm changeset` in the PR → `pnpm version-packages` (bumps version, writes CHANGELOG) → commit, tag
  `vX.Y.Z`, push → CI publishes to GitHub Packages (`publish` job; never runs on PRs).

## Development
```bash
pnpm i
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test        # starts an embedded PostgreSQL 18 (or uses DATABASE_URL_ADMIN); one database per test file
pnpm build       # dist/esm + dist/cjs (+ .d.ts), schemas/*.json
pnpm embed       # after editing migrations/ or prisma/core.prisma (src/generated/assets.ts)
```
Running the tests as root: PostgreSQL refuses root, so the embedded cluster runs as OS user `postgres`
(`EMBEDDED_PG_OS_USER`). Prisma's `validate` runs offline (WebAssembly); the test points
`PRISMA_SCHEMA_ENGINE_BINARY` at a stub because the CLI otherwise downloads the native schema engine at start.
