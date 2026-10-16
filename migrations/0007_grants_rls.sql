-- collective-asset-core 0007 — core.asset_access_grant, the visibility helpers, row-level security on every
-- core table (ENABLE + FORCE) and table privileges for gp_app / gp_platform / gp_reporting
-- (schema-design v2 §3.1.5, §4.5, §4.6; D-152).
--
-- Visibility rules (current tenant t = core.current_tenant_id(); module keys in src/grant-rules.ts):
--   own rows             tenant_id = t
--   owner / operator     buildings where owner_tenant_id = t or operator_tenant_id = t (and everything below them)
--   grants               active core.asset_access_grant rows to t: building scope (whole building) or unit scope
--                        (one unit), for the row's module or '*'; 'any' accepts a grant for any module
--   acts_for             the operator writes rows stamped with the owner's tenant_id (§4.6)
-- Helpers are SECURITY DEFINER, owned by gp_platform (BYPASSRLS) and called through (SELECT …) so the
-- planner evaluates them once per statement (InitPlan), not per row, and policies never recurse.

CREATE TABLE core.asset_access_grant (
  id                uuid NOT NULL DEFAULT uuidv7(),
  tenant_id         uuid NOT NULL,
  grantee_tenant_id uuid NOT NULL,
  building_id       uuid NOT NULL,
  unit_id           uuid,
  scope             core.grant_scope NOT NULL,
  modules           text[] NOT NULL,
  access            core.grant_access NOT NULL DEFAULT 'read',
  reason            core.grant_reason NOT NULL,
  valid_from        timestamptz(6) NOT NULL DEFAULT now(),
  valid_to          timestamptz(6),
  revoked_at        timestamptz(6),
  revoked_by        uuid,
  revoke_reason     text,
  source_ref        text,
  created_at        timestamptz(6) NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz(6) NOT NULL DEFAULT now(),
  updated_by        uuid,
  CONSTRAINT asset_access_grant_pkey PRIMARY KEY (id),
  CONSTRAINT asset_access_grant_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT asset_access_grant_grantee_tenant_id_fkey FOREIGN KEY (grantee_tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT asset_access_grant_building_id_fkey FOREIGN KEY (building_id) REFERENCES core.building (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT asset_access_grant_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES core.unit (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT asset_access_grant_scope_check CHECK ((scope = 'unit') = (unit_id IS NOT NULL)),
  CONSTRAINT asset_access_grant_grantee_check CHECK (grantee_tenant_id <> tenant_id),
  CONSTRAINT asset_access_grant_range_check CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT asset_access_grant_modules_check CHECK (cardinality(modules) > 0
    AND modules <@ ARRAY['core.asset', 'core.occupancy', 'ops.lease', 'ops.billing', 'ops.service', 'ops.community',
                         'smart.metering', 'smart.access', 'juristic', 'warranty', '*']::text[]),
  CONSTRAINT asset_access_grant_revoked_check CHECK (revoked_at IS NOT NULL OR (revoked_by IS NULL AND revoke_reason IS NULL))
);
COMMENT ON TABLE core.asset_access_grant IS 'The only way a tenant reads/writes another tenant''s building or unit (D-152, §4.5). Granted by the building owner or operator; revoked, never deleted.';
CREATE INDEX asset_access_grant_grantee_tenant_id_building_id_idx ON core.asset_access_grant (grantee_tenant_id, building_id) WHERE (revoked_at IS NULL);
CREATE INDEX asset_access_grant_grantee_tenant_id_unit_id_idx ON core.asset_access_grant (grantee_tenant_id, unit_id) WHERE ((revoked_at IS NULL) AND (unit_id IS NOT NULL));
CREATE INDEX asset_access_grant_tenant_id_building_id_idx ON core.asset_access_grant (tenant_id, building_id);
CREATE TRIGGER asset_access_grant_set_updated_at BEFORE UPDATE ON core.asset_access_grant FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ---------------------------------------------------------------------------------------------------------
-- Visibility helpers

-- Buildings the current tenant owns or operates, plus buildings with an active building-scope grant to it
-- covering `module` ('any' = any module; '*' grants cover every module) with at least `access`.
CREATE OR REPLACE FUNCTION core.accessible_building_ids(module text, access text DEFAULT 'read') RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
  SET search_path = pg_catalog
AS $$
  SELECT coalesce(array_agg(DISTINCT s.id), '{}'::uuid[])
    FROM (
      SELECT b.id FROM core.building b
       WHERE b.owner_tenant_id = core.current_tenant_id() OR b.operator_tenant_id = core.current_tenant_id()
      UNION ALL
      SELECT g.building_id FROM core.asset_access_grant g
       WHERE g.grantee_tenant_id = core.current_tenant_id()
         AND g.scope = 'building'
         AND g.revoked_at IS NULL
         AND g.valid_from <= now() AND (g.valid_to IS NULL OR g.valid_to > now())
         AND (module = 'any' OR g.modules && ARRAY[module, '*'])
         AND (access = 'read' OR g.access = 'write')
    ) s
$$;
COMMENT ON FUNCTION core.accessible_building_ids(text, text) IS 'uuid[] of buildings visible to the current tenant for a module: owner/operator buildings plus active building-scope grants (§4.5).';

-- Units with an active unit-scope grant to the current tenant covering `module`.
CREATE OR REPLACE FUNCTION core.accessible_unit_ids(module text, access text DEFAULT 'read') RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
  SET search_path = pg_catalog
AS $$
  SELECT coalesce(array_agg(DISTINCT g.unit_id), '{}'::uuid[])
    FROM core.asset_access_grant g
   WHERE g.grantee_tenant_id = core.current_tenant_id()
     AND g.scope = 'unit'
     AND g.revoked_at IS NULL
     AND g.valid_from <= now() AND (g.valid_to IS NULL OR g.valid_to > now())
     AND (module = 'any' OR g.modules && ARRAY[module, '*'])
     AND (access = 'read' OR g.access = 'write')
$$;
COMMENT ON FUNCTION core.accessible_unit_ids(text, text) IS 'uuid[] of units visible to the current tenant through active unit-scope grants for a module (§4.5).';

-- Properties that hold at least one building visible to the current tenant (an owner tenant sees the
-- property of the PM company operating its building).
CREATE OR REPLACE FUNCTION core.accessible_property_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
  SET search_path = pg_catalog
AS $$
  SELECT coalesce(array_agg(DISTINCT b.property_id), '{}'::uuid[])
    FROM core.building b
   WHERE b.id = ANY (core.accessible_building_ids('any'))
      OR b.id IN (SELECT u.building_id FROM core.unit u WHERE u.id = ANY (core.accessible_unit_ids('any')))
$$;

-- True when the current tenant may see the building (owner, operator or any active grant).
CREATE OR REPLACE FUNCTION core.can_see_building(building uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
  SET search_path = pg_catalog
AS $$ SELECT building = ANY (core.accessible_building_ids('any')) $$;

-- True when the current tenant owns or operates the building (may grant access to it).
CREATE OR REPLACE FUNCTION core.owns_or_operates(building uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
  SET search_path = pg_catalog
AS $$
  SELECT EXISTS (SELECT 1 FROM core.building b
                  WHERE b.id = building
                    AND (b.owner_tenant_id = core.current_tenant_id() OR b.operator_tenant_id = core.current_tenant_id()))
$$;

-- True when the current tenant operates the building and `row_tenant` is its owner: the operator writes
-- rows on behalf of the owner, stamped with the owner's tenant_id (§4.6).
CREATE OR REPLACE FUNCTION core.acts_for(row_tenant uuid, building uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
  SET search_path = pg_catalog
AS $$
  SELECT EXISTS (SELECT 1 FROM core.building b
                  WHERE b.id = building
                    AND b.operator_tenant_id = core.current_tenant_id()
                    AND b.owner_tenant_id = row_tenant)
$$;

-- The wrapped DEK of the current tenant for a key id (gp_app cannot read core.tenant_data_key directly).
CREATE OR REPLACE FUNCTION core.tenant_dek(key_id smallint DEFAULT NULL)
  RETURNS TABLE (kid smallint, wrapped_dek bytea, kek_ref text, algorithm text, state core.data_key_state)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
  SELECT k.kid, k.wrapped_dek, k.kek_ref, k.algorithm, k.state
    FROM core.tenant_data_key k
   WHERE k.tenant_id = core.current_tenant_id()
     AND k.state <> 'destroyed'
     AND (key_id IS NULL AND k.state = 'active' OR k.kid = key_id)
$$;

-- SECURITY DEFINER helpers and the definer triggers run as gp_platform (BYPASSRLS): no policy recursion,
-- and a tenant cannot hide rows from a consistency check by not seeing them.
ALTER FUNCTION core.accessible_building_ids(text, text) OWNER TO gp_platform;
ALTER FUNCTION core.accessible_unit_ids(text, text) OWNER TO gp_platform;
ALTER FUNCTION core.accessible_property_ids() OWNER TO gp_platform;
ALTER FUNCTION core.can_see_building(uuid) OWNER TO gp_platform;
ALTER FUNCTION core.owns_or_operates(uuid) OWNER TO gp_platform;
ALTER FUNCTION core.acts_for(uuid, uuid) OWNER TO gp_platform;
ALTER FUNCTION core.tenant_dek(smallint) OWNER TO gp_platform;
ALTER FUNCTION core.close_previous_period() OWNER TO gp_platform;
ALTER FUNCTION core.check_unit_ownership_share() OWNER TO gp_platform;

-- ---------------------------------------------------------------------------------------------------------
-- Privileges. RLS decides which rows; grants decide which statements. gp_reporting is read-only.
GRANT USAGE ON SCHEMA core TO gp_app, gp_platform, gp_reporting;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core TO gp_app, gp_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA core TO gp_reporting;
REVOKE ALL ON core.tenant_data_key FROM gp_app, gp_reporting;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA core TO gp_app, gp_platform, gp_reporting;
REVOKE EXECUTE ON FUNCTION core.tenant_dek(smallint) FROM PUBLIC, gp_reporting;
GRANT EXECUTE ON FUNCTION core.tenant_dek(smallint) TO gp_app, gp_platform;

-- ---------------------------------------------------------------------------------------------------------
-- Row-level security: ENABLE + FORCE on every core table. Policies apply to every role without BYPASSRLS
-- (gp_app, gp_reporting, and the table owner because of FORCE).
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant', 'tenant_data_key', 'membership', 'user_account', 'user_identity', 'property',
                           'building', 'building_operator_period', 'floor', 'unit', 'party', 'party_user_link',
                           'unit_ownership', 'occupancy', 'asset_item', 'meter_assignment', 'document', 'asset_access_grant'] LOOP
    EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$rls$;

-- tenant: a tenant sees and updates itself; creation and deactivation are platform operations (gp_platform).
CREATE POLICY tenant_rls_read ON core.tenant FOR SELECT USING (id = (SELECT core.current_tenant_id()));
CREATE POLICY tenant_rls_update ON core.tenant FOR UPDATE
  USING (id = (SELECT core.current_tenant_id())) WITH CHECK (id = (SELECT core.current_tenant_id()));

-- tenant_data_key: no policy — invisible to gp_app/gp_reporting; read through core.tenant_dek().

-- Plain tenant-owned tables (RLS:T)
CREATE POLICY membership_rls_t ON core.membership FOR ALL
  USING (tenant_id = (SELECT core.current_tenant_id())) WITH CHECK (tenant_id = (SELECT core.current_tenant_id()));
CREATE POLICY party_rls_t ON core.party FOR ALL
  USING (tenant_id = (SELECT core.current_tenant_id())) WITH CHECK (tenant_id = (SELECT core.current_tenant_id()));
CREATE POLICY party_user_link_rls_t ON core.party_user_link FOR ALL
  USING (tenant_id = (SELECT core.current_tenant_id())) WITH CHECK (tenant_id = (SELECT core.current_tenant_id()));
CREATE POLICY document_rls_t ON core.document FOR ALL
  USING (tenant_id = (SELECT core.current_tenant_id())) WITH CHECK (tenant_id = (SELECT core.current_tenant_id()));

-- user_account / user_identity (RLS:P, §7.4 Q7): identity lookups run as gp_platform; a signed-in user sees
-- only its own account (app.actor_id).
CREATE POLICY user_account_rls_self ON core.user_account FOR SELECT USING (id = (SELECT core.current_actor_id()));
CREATE POLICY user_identity_rls_self ON core.user_identity FOR SELECT USING (user_id = (SELECT core.current_actor_id()));

-- property: own rows; read also when one of its buildings is visible.
CREATE POLICY property_rls_read ON core.property FOR SELECT
  USING (tenant_id = (SELECT core.current_tenant_id()) OR id = ANY ((SELECT core.accessible_property_ids())::uuid[]));
CREATE POLICY property_rls_write ON core.property FOR ALL
  USING (tenant_id = (SELECT core.current_tenant_id())) WITH CHECK (tenant_id = (SELECT core.current_tenant_id()));

-- building (RLS:B(any)): data-owner, owner and operator tenants, and any grantee.
CREATE POLICY building_rls_read ON core.building FOR SELECT
  USING (tenant_id = (SELECT core.current_tenant_id()) OR id = ANY ((SELECT core.accessible_building_ids('any'))::uuid[]));
CREATE POLICY building_rls_write ON core.building FOR ALL
  USING (tenant_id = (SELECT core.current_tenant_id())
         OR owner_tenant_id = (SELECT core.current_tenant_id())
         OR operator_tenant_id = (SELECT core.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT core.current_tenant_id())
              OR owner_tenant_id = (SELECT core.current_tenant_id())
              OR operator_tenant_id = (SELECT core.current_tenant_id()));

-- Rows below a building (RLS:B(module)): own rows, owner/operator buildings, building grants for the module.
-- Writes: own rows or rows the operator writes for the owner (core.asset is never writable by grantees).
CREATE POLICY building_operator_period_rls_read ON core.building_operator_period FOR SELECT
  USING (tenant_id = (SELECT core.current_tenant_id()) OR building_id = ANY ((SELECT core.accessible_building_ids('any'))::uuid[]));
CREATE POLICY building_operator_period_rls_write ON core.building_operator_period FOR ALL
  USING (tenant_id = (SELECT core.current_tenant_id()) OR core.acts_for(tenant_id, building_id))
  WITH CHECK (tenant_id = (SELECT core.current_tenant_id()) OR core.acts_for(tenant_id, building_id));

CREATE POLICY floor_rls_read ON core.floor FOR SELECT
  USING (tenant_id = (SELECT core.current_tenant_id()) OR building_id = ANY ((SELECT core.accessible_building_ids('any'))::uuid[]));
CREATE POLICY floor_rls_write ON core.floor FOR ALL
  USING (tenant_id = (SELECT core.current_tenant_id()) OR core.acts_for(tenant_id, building_id))
  WITH CHECK (tenant_id = (SELECT core.current_tenant_id()) OR core.acts_for(tenant_id, building_id));

CREATE POLICY asset_item_rls_read ON core.asset_item FOR SELECT
  USING (tenant_id = (SELECT core.current_tenant_id()) OR building_id = ANY ((SELECT core.accessible_building_ids('core.asset'))::uuid[]));
CREATE POLICY asset_item_rls_write ON core.asset_item FOR ALL
  USING (tenant_id = (SELECT core.current_tenant_id()) OR core.acts_for(tenant_id, building_id))
  WITH CHECK (tenant_id = (SELECT core.current_tenant_id()) OR core.acts_for(tenant_id, building_id));

-- Rows below a unit (RLS:U(module)) also accept unit-scope grants (a landlord's unit in a building it does
-- not operate).
CREATE POLICY unit_rls_read ON core.unit FOR SELECT
  USING (tenant_id = (SELECT core.current_tenant_id())
         OR building_id = ANY ((SELECT core.accessible_building_ids('any'))::uuid[])
         OR id = ANY ((SELECT core.accessible_unit_ids('any'))::uuid[]));
CREATE POLICY unit_rls_write ON core.unit FOR ALL
  USING (tenant_id = (SELECT core.current_tenant_id()) OR core.acts_for(tenant_id, building_id))
  WITH CHECK (tenant_id = (SELECT core.current_tenant_id()) OR core.acts_for(tenant_id, building_id));

CREATE POLICY unit_ownership_rls_read ON core.unit_ownership FOR SELECT
  USING (tenant_id = (SELECT core.current_tenant_id())
         OR building_id = ANY ((SELECT core.accessible_building_ids('core.asset'))::uuid[])
         OR unit_id = ANY ((SELECT core.accessible_unit_ids('core.asset'))::uuid[]));
CREATE POLICY unit_ownership_rls_write ON core.unit_ownership FOR ALL
  USING (tenant_id = (SELECT core.current_tenant_id()) OR core.acts_for(tenant_id, building_id))
  WITH CHECK (tenant_id = (SELECT core.current_tenant_id()) OR core.acts_for(tenant_id, building_id));

CREATE POLICY occupancy_rls_read ON core.occupancy FOR SELECT
  USING (tenant_id = (SELECT core.current_tenant_id())
         OR building_id = ANY ((SELECT core.accessible_building_ids('core.occupancy'))::uuid[])
         OR unit_id = ANY ((SELECT core.accessible_unit_ids('core.occupancy'))::uuid[])
         OR building_id = ANY ((SELECT core.accessible_building_ids('ops.lease'))::uuid[])
         OR unit_id = ANY ((SELECT core.accessible_unit_ids('ops.lease'))::uuid[]));
CREATE POLICY occupancy_rls_write ON core.occupancy FOR ALL
  USING (tenant_id = (SELECT core.current_tenant_id()) OR core.acts_for(tenant_id, building_id))
  WITH CHECK (tenant_id = (SELECT core.current_tenant_id()) OR core.acts_for(tenant_id, building_id));

CREATE POLICY meter_assignment_rls_read ON core.meter_assignment FOR SELECT
  USING (tenant_id = (SELECT core.current_tenant_id())
         OR building_id = ANY ((SELECT core.accessible_building_ids('smart.metering'))::uuid[])
         OR unit_id = ANY ((SELECT core.accessible_unit_ids('smart.metering'))::uuid[]));
CREATE POLICY meter_assignment_rls_write ON core.meter_assignment FOR ALL
  USING (tenant_id = (SELECT core.current_tenant_id()) OR core.acts_for(tenant_id, building_id))
  WITH CHECK (tenant_id = (SELECT core.current_tenant_id()) OR core.acts_for(tenant_id, building_id));

-- asset_access_grant: grantor and grantee read; only the grantor writes, and only for a building it owns or
-- operates.
CREATE POLICY asset_access_grant_rls_read ON core.asset_access_grant FOR SELECT
  USING (tenant_id = (SELECT core.current_tenant_id()) OR grantee_tenant_id = (SELECT core.current_tenant_id()));
CREATE POLICY asset_access_grant_rls_write ON core.asset_access_grant FOR ALL
  USING (tenant_id = (SELECT core.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT core.current_tenant_id()) AND core.owns_or_operates(building_id));
