-- collective-asset-core 0.7.0 / 0013 — agency tenants and listing mandates for getproperty G2 (D-284, D-287;
-- additive within the 0.x major, D-153), and a generic legal-hold guard on documents (getproperty G1, D-286).
-- * tenant_type `agency` (an estate agency / broker organisation, free and unlimited per D-284).
-- * grant_reason `listing_mandate`: a unit owner mandates an agency to list (and lease / manage) one unit.
-- * grant module key `ops.listing` (the app's listing rows of a mandated unit).
-- * The tenant holding a unit row may grant that one unit with reason `listing_mandate` and app modules only
--   (`ops.listing`, `ops.lease`, `ops.billing`, `ops.service`), even when it neither owns nor operates the building
--   (a landlord's unit in a condo stub or in another tenant's building, D-251 / D-280). A unit grant still does not
--   open the building row.
-- * core.document.legal_hold / legal_hold_until: a hold the app places on a document the law requires to keep.
--   While it is in force (legal_hold and legal_hold_until null or in the future) the document can be neither
--   soft-deleted (deleted_at) nor deleted: trigger document_legal_hold_guard raises `core.legal_hold` (P0001).
--   Core knows nothing about why a document is held; the app keeps the two columns in step with its own records.
ALTER TYPE core.tenant_type ADD VALUE IF NOT EXISTS 'agency';
ALTER TYPE core.grant_reason ADD VALUE IF NOT EXISTS 'listing_mandate';

ALTER TABLE core.asset_access_grant DROP CONSTRAINT asset_access_grant_modules_check;
ALTER TABLE core.asset_access_grant ADD CONSTRAINT asset_access_grant_modules_check CHECK (cardinality(modules) > 0
  AND modules <@ ARRAY['core.asset', 'core.occupancy', 'ops.lease', 'ops.billing', 'ops.service', 'ops.community',
                       'ops.listing', 'smart.metering', 'smart.access', 'juristic', 'warranty', '*']::text[]);

-- True when the current tenant holds the (live) unit row.
CREATE OR REPLACE FUNCTION core.holds_unit(unit uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
  SET search_path = pg_catalog
AS $$
  SELECT EXISTS (SELECT 1 FROM core.unit u
                  WHERE u.id = unit AND u.tenant_id = core.current_tenant_id() AND u.deleted_at IS NULL)
$$;
COMMENT ON FUNCTION core.holds_unit(uuid) IS 'True when the current tenant holds the unit row (may mandate an agency for it, 0013).';
ALTER FUNCTION core.holds_unit(uuid) OWNER TO gp_platform;
GRANT EXECUTE ON FUNCTION core.holds_unit(uuid) TO gp_app, gp_reporting, gp_platform;

-- (text comparison: the enum value added above cannot be used as a literal in the same transaction)
DROP POLICY asset_access_grant_rls_write ON core.asset_access_grant;
CREATE POLICY asset_access_grant_rls_write ON core.asset_access_grant FOR ALL
  USING (tenant_id = (SELECT core.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT core.current_tenant_id())
              AND (core.owns_or_operates(building_id)
                   OR (scope = 'unit' AND reason::text = 'listing_mandate'
                       AND modules <@ ARRAY['ops.listing', 'ops.lease', 'ops.billing', 'ops.service']::text[]
                       AND core.holds_unit(unit_id))));

ALTER TABLE core.document ADD COLUMN legal_hold boolean NOT NULL DEFAULT false;
ALTER TABLE core.document ADD COLUMN legal_hold_until timestamptz(6);
ALTER TABLE core.document ADD CONSTRAINT document_legal_hold_check CHECK (legal_hold OR legal_hold_until IS NULL);
COMMENT ON COLUMN core.document.legal_hold IS 'The app holds this document for a legal retention period (D-286): no soft or hard delete while in force.';
COMMENT ON COLUMN core.document.legal_hold_until IS 'End of the legal hold; null while legal_hold = open-ended (e.g. until the lease ends).';

CREATE OR REPLACE FUNCTION core.document_legal_hold_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.legal_hold AND (OLD.legal_hold_until IS NULL OR OLD.legal_hold_until > now())
     AND (TG_OP = 'DELETE' OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'core.legal_hold: document % is under a legal hold (% refused)', OLD.id, TG_OP
      USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
COMMENT ON FUNCTION core.document_legal_hold_guard() IS 'Refuses deleting or soft-deleting a document while its legal hold is in force (0013, D-286).';
CREATE TRIGGER document_legal_hold_guard_update BEFORE UPDATE OF deleted_at ON core.document
  FOR EACH ROW EXECUTE FUNCTION core.document_legal_hold_guard();
CREATE TRIGGER document_legal_hold_guard_delete BEFORE DELETE ON core.document
  FOR EACH ROW EXECUTE FUNCTION core.document_legal_hold_guard();
