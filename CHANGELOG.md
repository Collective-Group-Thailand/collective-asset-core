# @collective/asset-core

## 0.7.0 — 2026-10-27

Additive (D-153: allowed within the 0.x major), for getproperty G2 (agency tenants and listing mandates, D-284, D-287)
and the legal-hold guard getproperty G1 asked for (D-286).

- Migration `0013_agency_mandates`: `tenant_type` `agency`; `grant_reason` `listing_mandate`; grant module key
  `ops.listing` (`asset_access_grant_modules_check` replaced).
- Grant write policy: besides the building's owner or operator, the tenant **holding a unit row**
  (`core.holds_unit(uuid)`, SECURITY DEFINER) may grant that one unit with reason `listing_mandate` and app modules
  only (`ops.listing`, `ops.lease`, `ops.billing`, `ops.service`) — a landlord's unit in a condo stub or in another
  tenant's building. A unit grant still does not open the building row.
- `core.document.legal_hold` (boolean, default false) + `legal_hold_until` (timestamptz; null while held =
  open-ended), CHECK `document_legal_hold_check`; triggers `document_legal_hold_guard_update` (`BEFORE UPDATE OF
  deleted_at`) and `document_legal_hold_guard_delete` (`BEFORE DELETE`) raise `core.legal_hold` (P0001) while the hold
  is in force. Generic: core does not know why a document is held; the app mirrors its own hold records.
- `TENANT_TYPES`, `GRANT_REASONS`, `GRANT_MODULES`, `GRANTEE_WRITABLE_MODULES`, new `UNIT_HOLDER_GRANT_MODULES`,
  `DocumentRow`, `prisma/core.prisma` updated; tests +5 (`agency-mandates.test.ts`).

## 0.6.0 — 2026-10-25

Additive (D-153: allowed within the 0.x major), for getproperty B7.5 (landlord document set, D-253).

- Migration `0012_landlord_documents`: `document_kind` `pdf_notice` (lease notices: rent increase, renewal offer,
  non-renewal, termination, late payment), `pdf_certificate` (rent payment certificate), `pdf_summary` (annual rental
  income summary).
- `DOCUMENT_KINDS` and `prisma/core.prisma` updated.

## 0.5.0 — 2026-10-25

Additive (D-153: allowed within the 0.x major), for getproperty B7.1 (landlord self-serve and portfolio, D-251, D-255).

- Migration `0011_landlord_portfolio`: enum values `identity_provider` `phone_otp`, `firebase_google`, `firebase_apple`
  (the sign-in providers of getpack); `building_type.house`; `building_status.external`; `ownership_source.self_declared`;
  `document_kind` `listing_photo`, `inspection_report`.
- `core.building.operator_tenant_id` is nullable for **external stubs only** (CHECK `building_operator_required_check`):
  a condo that is not on the platform yet, created when a landlord adds a unit there.
- RLS: a tenant reads the building and property of every unit row it holds (`core.own_unit_building_ids()`,
  `core.own_unit_property_ids()`, SECURITY DEFINER, owned by `gp_platform`), so landlords with units in one stub condo
  share the stub and still see only their own units. Policies `building_rls_read` and `property_rls_read` replaced.
- `IDENTITY_PROVIDERS`, `BUILDING_TYPES`, `BUILDING_STATUSES`, `OWNERSHIP_SOURCES`, `DOCUMENT_KINDS`, `BuildingRow` and
  `prisma/core.prisma` updated; tests +3 (stub without operator, shared stub visibility, landlord writes).

## 0.4.0 — 2026-10-22

Additive (D-153: allowed within the 0.x major), for the Collective platform (getproperty blueprint tasks T-3, T-16).

- Migration runner: a **non-superuser runner** (the platform's product login — database owner, `NOCREATEROLE`, member
  of the group roles created by the platform's postgres init script) needs no manual grant any more. When pending
  migrations exist, the runner is not a superuser, `gp_platform` exists and lacks it, the runner grants
  `CREATE ON SCHEMA core TO gp_platform` for the duration of the run (0007 hands the SECURITY DEFINER helpers to
  `gp_platform`, which PostgreSQL allows only when the new owner may create in the schema) and revokes it afterwards,
  so `gp_platform` keeps no DDL right on `core`. No migration changed (checksums unchanged). Apps that granted it
  themselves (getproperty-api `migrateCoreAsProductLogin`) drop that workaround.
- Contracts: the cross-product **webhook transport** (D-238) — `signIntegrationWebhook()`,
  `verifyIntegrationWebhook()`, `WEBHOOK_HEADERS` (`X-Collective-Event-Id`, `-Source`, `-Timestamp`,
  `-Signature: v1=<hex HMAC-SHA256(key, "<ts>.<raw body>")>`, several `v1=` during a key rotation, ±300 s).
- Tests +5 (non-superuser migration, webhook signing).

## 0.3.0 — 2026-10-17

Additive (D-153: allowed within the 0.x major), for getproperty B2 (leases, e-signature, occupancy).

- Migration `0010_lease_documents`: enum value `core.document_kind.signature` (drawn signature images of e-signed
  contracts and inspection reports, D-062) and the partial index `occupancy_lease_id_idx` on
  `core.occupancy (lease_id) WHERE lease_id IS NOT NULL` (lease activation opens and the lease end closes the
  occupancies of a lease).
- `DOCUMENT_KINDS` and `prisma/core.prisma` updated; tests +2.

## 0.2.1 — 2026-10-17

Fix (patch).

- Migration `0009_grant_access_argument`: `core.accessible_building_ids(module, access)` and
  `core.accessible_unit_ids(module, access)` compared the grant's own `access` column instead of the `access`
  argument (a column name shadows a parameter name in SQL-language functions), so a `read` grant answered `true` for
  `write`. Both functions now use positional parameters; signatures unchanged. RLS policies (which ask for `read`)
  were not affected. Test 66 (read grant ≠ write access).

## 0.2.0 — 2026-10-17

Additive (D-153: allowed within the 0.x major), for getproperty B1.3 resident sign-in.

- Migration `0008_party_matching`: enum value `core.party_link_via.phone_match` (a resident who verified a phone by
  SMS OTP is linked to the parties carrying that phone); partial indexes `party_phone_e164_idx` and
  `party_line_user_id_idx` (`WHERE deleted_at IS NULL AND anonymised_at IS NULL`) for the cross-tenant lookups the
  identity service runs as `gp_platform`.
- `PARTY_LINK_VIAS` and `prisma/core.prisma` (enum value + two `@@index`) updated; tests 65.

## 0.1.0 — 2026-10-17

First release (B1.2 step 2a, schema-design v2 §7.1, ADR-0010).

- Schema `core`: 7 SQL migrations — extensions, `uuidv7()` guard, roles `gp_owner`/`gp_app`/`gp_platform`/
  `gp_reporting`, trigger functions (`set_updated_at`, `deny_mutation`, `close_previous_period`), 31 enums,
  18 tables (tenant, tenant_data_key, membership, user_account, user_identity, property, building,
  building_operator_period, floor, unit, party, party_user_link, unit_ownership, occupancy, asset_item,
  meter_assignment, document, asset_access_grant) with their CHECK/EXCLUDE constraints and partial indexes,
  the deferred ownership-share trigger, helper functions (`current_tenant_id`, `current_actor_id`,
  `accessible_building_ids`, `accessible_unit_ids`, `accessible_property_ids`, `can_see_building`,
  `owns_or_operates`, `acts_for`, `tenant_dek`), RLS enabled + forced with owner/operator/grant visibility.
- Migration runner `assetCoreMigrate()` / `asset-core migrate|status|sql` with `core._migration` checksums.
- Prisma fragment `prisma/core.prisma` and `asset-core prisma-fragment` (back-relation injection).
- TS enums, row types, grant rule set, `withTenant()`, field envelope, `configurePgTypes()`.
- Integration contracts (zod 4): envelope + 8 events, fixtures, JSON Schemas.
- `checkPrismaDrift()` testing helper.
