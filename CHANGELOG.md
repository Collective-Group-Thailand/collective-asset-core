# @collective/asset-core

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
