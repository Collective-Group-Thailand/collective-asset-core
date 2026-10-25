-- collective-asset-core 0.5.0 / 0011 — landlord self-serve and portfolio units for getproperty B7.1 (D-251, D-255;
-- additive within the 0.x major, D-153).
-- * identity_provider: phone_otp, firebase_google, firebase_apple — the sign-in providers of getpack (D-255).
-- * building_type `house` (a one-unit house or townhouse), building_status `external` (a stub of a condo that is not
--   on the platform yet: owner and operator unknown), ownership_source `self_declared` (the landlord says it owns
--   the unit; verification is the app's, D-252), document kinds `listing_photo` and `inspection_report`.
-- * building.operator_tenant_id becomes nullable for external stubs only (CHECK).
-- * A tenant reads the building and property of every unit row it holds (`core.own_unit_building_ids()`,
--   `core.own_unit_property_ids()`): two
--   landlords with units in the same stub condo both see the stub, and still only their own units.
ALTER TYPE core.identity_provider ADD VALUE IF NOT EXISTS 'phone_otp';
ALTER TYPE core.identity_provider ADD VALUE IF NOT EXISTS 'firebase_google';
ALTER TYPE core.identity_provider ADD VALUE IF NOT EXISTS 'firebase_apple';
ALTER TYPE core.building_type ADD VALUE IF NOT EXISTS 'house';
ALTER TYPE core.building_status ADD VALUE IF NOT EXISTS 'external';
ALTER TYPE core.ownership_source ADD VALUE IF NOT EXISTS 'self_declared';
ALTER TYPE core.document_kind ADD VALUE IF NOT EXISTS 'listing_photo';
ALTER TYPE core.document_kind ADD VALUE IF NOT EXISTS 'inspection_report';

ALTER TABLE core.building ALTER COLUMN operator_tenant_id DROP NOT NULL;
-- (text comparison: a value added above cannot be used as an enum literal in the same transaction)
ALTER TABLE core.building ADD CONSTRAINT building_operator_required_check
  CHECK (operator_tenant_id IS NOT NULL OR status::text = 'external');
COMMENT ON COLUMN core.building.operator_tenant_id IS 'The tenant running the building; null only for an external stub (a condo not on the platform yet, D-251).';

CREATE OR REPLACE FUNCTION core.own_unit_building_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
  SET search_path = pg_catalog
AS $$
  SELECT coalesce(array_agg(DISTINCT u.building_id), '{}'::uuid[])
    FROM core.unit u
   WHERE u.tenant_id = core.current_tenant_id() AND u.deleted_at IS NULL
$$;
COMMENT ON FUNCTION core.own_unit_building_ids() IS 'uuid[] of buildings holding a unit row of the current tenant (a landlord''s unit in a stub or another tenant''s building, D-251).';
ALTER FUNCTION core.own_unit_building_ids() OWNER TO gp_platform;
GRANT EXECUTE ON FUNCTION core.own_unit_building_ids() TO gp_app, gp_reporting, gp_platform;

CREATE OR REPLACE FUNCTION core.own_unit_property_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
  SET search_path = pg_catalog
AS $$
  SELECT coalesce(array_agg(DISTINCT u.property_id), '{}'::uuid[])
    FROM core.unit u
   WHERE u.tenant_id = core.current_tenant_id() AND u.deleted_at IS NULL
$$;
COMMENT ON FUNCTION core.own_unit_property_ids() IS 'uuid[] of properties holding a unit row of the current tenant (D-251).';
ALTER FUNCTION core.own_unit_property_ids() OWNER TO gp_platform;
GRANT EXECUTE ON FUNCTION core.own_unit_property_ids() TO gp_app, gp_reporting, gp_platform;

DROP POLICY property_rls_read ON core.property;
CREATE POLICY property_rls_read ON core.property FOR SELECT
  USING (tenant_id = (SELECT core.current_tenant_id())
         OR id = ANY ((SELECT core.accessible_property_ids())::uuid[])
         OR id = ANY ((SELECT core.own_unit_property_ids())::uuid[]));

DROP POLICY building_rls_read ON core.building;
CREATE POLICY building_rls_read ON core.building FOR SELECT
  USING (tenant_id = (SELECT core.current_tenant_id())
         OR id = ANY ((SELECT core.accessible_building_ids('any'))::uuid[])
         OR id = ANY ((SELECT core.own_unit_building_ids())::uuid[]));
