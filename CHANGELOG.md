# @collective/asset-core

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
