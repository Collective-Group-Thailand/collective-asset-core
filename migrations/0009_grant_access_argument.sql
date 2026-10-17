-- collective-asset-core 0.2.1 / 0009 — fix: the `access` argument of core.accessible_building_ids() and
-- core.accessible_unit_ids() was shadowed by the asset_access_grant.access column (in SQL-language functions a column
-- name wins over a parameter name), so `access = 'read'` compared the grant's own column and a read grant answered
-- true for 'write'. The functions now use positional parameters; signatures, volatility and grants are unchanged.
-- RLS policies only ask for 'read' (the default) and were not affected; callers asking 'write' were.

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
         AND ($1 = 'any' OR g.modules && ARRAY[$1, '*'])
         AND ($2 = 'read' OR g.access = 'write')
    ) s
$$;

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
     AND ($1 = 'any' OR g.modules && ARRAY[$1, '*'])
     AND ($2 = 'read' OR g.access = 'write')
$$;
