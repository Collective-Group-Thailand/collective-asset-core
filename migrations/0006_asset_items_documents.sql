-- collective-asset-core 0006 — asset items, meter assignments, documents (schema-design v2 §3.1.4, §3.1.5).
-- Late FKs: core.tenant.logo_document_id, core.floor.plan_document_id.

CREATE TABLE core.asset_item (
  id                  uuid NOT NULL DEFAULT uuidv7(),
  tenant_id           uuid NOT NULL,
  building_id         uuid NOT NULL,
  floor_id            uuid,
  unit_id             uuid,
  category            core.asset_category NOT NULL,
  name                text NOT NULL,
  manufacturer        text,
  model               text,
  serial              citext,
  qr_code             text,
  location            text,
  install_date        date,
  expected_life_years numeric(5,2),
  warranty_until      date,
  warranty_party_id   uuid,
  status              core.asset_status NOT NULL DEFAULT 'active',
  retired_at          timestamptz(6),
  retired_reason      text,
  meta                jsonb NOT NULL DEFAULT '{}',
  source_ref          text,
  created_at          timestamptz(6) NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz(6) NOT NULL DEFAULT now(),
  updated_by          uuid,
  deleted_at          timestamptz(6),
  deleted_by          uuid,
  CONSTRAINT asset_item_pkey PRIMARY KEY (id),
  CONSTRAINT asset_item_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT asset_item_building_id_fkey FOREIGN KEY (building_id) REFERENCES core.building (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT asset_item_floor_id_fkey FOREIGN KEY (floor_id) REFERENCES core.floor (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT asset_item_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES core.unit (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT asset_item_warranty_party_id_fkey FOREIGN KEY (warranty_party_id) REFERENCES core.party (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT asset_item_expected_life_years_check CHECK (expected_life_years IS NULL OR expected_life_years > 0),
  CONSTRAINT asset_item_retired_check CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);
COMMENT ON TABLE core.asset_item IS 'Meters, gateways, locks, breakers, pumps, lifts, cameras, appliances … (unit_id null = common area). Breakers exist so prepaid/cut-off could be added later without migration, but no cut-off exists (D-024, D-157).';
CREATE INDEX asset_item_tenant_id_building_id_category_idx ON core.asset_item (tenant_id, building_id, category);
CREATE UNIQUE INDEX asset_item_building_id_category_serial_key ON core.asset_item (building_id, category, serial) WHERE ((serial IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX asset_item_unit_id_idx ON core.asset_item (unit_id);

CREATE TABLE core.meter_assignment (
  id                uuid NOT NULL DEFAULT uuidv7(),
  tenant_id         uuid NOT NULL,
  building_id       uuid NOT NULL,
  asset_item_id     uuid NOT NULL,
  unit_id           uuid,
  purpose           core.meter_purpose NOT NULL,
  utility           core.utility NOT NULL,
  code              citext NOT NULL,
  common_area_label text,
  valid_from        timestamptz(6) NOT NULL,
  valid_to          timestamptz(6),
  multiplier        numeric(12,6) NOT NULL DEFAULT 1,
  initial_reading   numeric(12,3) NOT NULL DEFAULT 0,
  final_reading     numeric(12,3),
  rollover_at       numeric(12,3) NOT NULL DEFAULT 99999.999,
  close_reason      core.meter_close_reason,
  created_at        timestamptz(6) NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz(6) NOT NULL DEFAULT now(),
  updated_by        uuid,
  CONSTRAINT meter_assignment_pkey PRIMARY KEY (id),
  CONSTRAINT meter_assignment_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT meter_assignment_building_id_fkey FOREIGN KEY (building_id) REFERENCES core.building (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT meter_assignment_asset_item_id_fkey FOREIGN KEY (asset_item_id) REFERENCES core.asset_item (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT meter_assignment_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES core.unit (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT meter_assignment_unit_purpose_check CHECK ((purpose = 'unit') = (unit_id IS NOT NULL)),
  CONSTRAINT meter_assignment_closed_check CHECK (valid_to IS NULL OR final_reading IS NOT NULL),
  CONSTRAINT meter_assignment_range_check CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT meter_assignment_multiplier_check CHECK (multiplier > 0),
  CONSTRAINT meter_assignment_initial_reading_check CHECK (initial_reading >= 0),
  CONSTRAINT meter_assignment_rollover_at_check CHECK (rollover_at > 0),
  CONSTRAINT meter_assignment_asset_no_overlap EXCLUDE USING gist (asset_item_id WITH =, tstzrange(valid_from, valid_to) WITH &&),
  CONSTRAINT meter_assignment_unit_no_overlap EXCLUDE USING gist (unit_id WITH =, utility WITH =, tstzrange(valid_from, valid_to) WITH &&) WHERE (purpose = 'unit')
);
COMMENT ON TABLE core.meter_assignment IS 'A meter asset item bound to a unit or common area over time; a swap closes one assignment (final_reading) and opens the next (initial_reading) at the same instant. Unit: electric → kwh, water → m3.';
CREATE UNIQUE INDEX meter_assignment_building_id_code_valid_from_key ON core.meter_assignment (building_id, code, valid_from);
CREATE INDEX meter_assignment_tenant_id_building_id_utility_purpose_idx ON core.meter_assignment (tenant_id, building_id, utility, purpose);
CREATE INDEX meter_assignment_unit_id_idx ON core.meter_assignment (unit_id);

CREATE TABLE core.document (
  id                     uuid NOT NULL DEFAULT uuidv7(),
  tenant_id              uuid,
  scope_type             core.document_scope NOT NULL,
  scope_id               uuid,
  building_id            uuid,
  kind                   core.document_kind NOT NULL,
  title                  text,
  storage_bucket         text NOT NULL,
  storage_key            text NOT NULL,
  mime_type              text NOT NULL,
  size_bytes             bigint NOT NULL,
  sha256                 bytea NOT NULL,
  width                  integer,
  height                 integer,
  version_of_document_id uuid,
  version_no             integer NOT NULL DEFAULT 1,
  retention_class        text NOT NULL,
  expires_at             timestamptz(6),
  scan_status            core.document_scan_status NOT NULL DEFAULT 'pending',
  scanned_at             timestamptz(6),
  upload_state           core.document_upload_state NOT NULL DEFAULT 'presigned',
  uploaded_at            timestamptz(6),
  thumbnail_key          text,
  source_ref             text,
  created_at             timestamptz(6) NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_at             timestamptz(6) NOT NULL DEFAULT now(),
  updated_by             uuid,
  deleted_at             timestamptz(6),
  deleted_by             uuid,
  delete_reason          text,
  CONSTRAINT document_pkey PRIMARY KEY (id),
  CONSTRAINT document_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT document_building_id_fkey FOREIGN KEY (building_id) REFERENCES core.building (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT document_version_of_document_id_fkey FOREIGN KEY (version_of_document_id) REFERENCES core.document (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT document_size_bytes_check CHECK (size_bytes > 0),
  CONSTRAINT document_sha256_check CHECK (octet_length(sha256) = 32),
  CONSTRAINT document_version_no_check CHECK (version_no >= 1),
  CONSTRAINT document_platform_scope_check CHECK ((scope_type = 'platform') = (tenant_id IS NULL))
);
COMMENT ON TABLE core.document IS 'Every stored file (contracts, as-built drawings, photos, slips, ID images, PDFs, exports, OTA artefacts). tenant_id null = platform file (gp_platform only).';
CREATE UNIQUE INDEX document_storage_key_key ON core.document (storage_key);
CREATE INDEX document_tenant_id_scope_type_scope_id_idx ON core.document (tenant_id, scope_type, scope_id);
CREATE INDEX document_tenant_id_kind_created_at_idx ON core.document (tenant_id, kind, created_at);
CREATE INDEX document_expires_at_idx ON core.document (expires_at) WHERE (deleted_at IS NULL);
CREATE INDEX document_sha256_idx ON core.document (sha256);

ALTER TABLE core.tenant
  ADD CONSTRAINT tenant_logo_document_id_fkey FOREIGN KEY (logo_document_id) REFERENCES core.document (id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE core.floor
  ADD CONSTRAINT floor_plan_document_id_fkey FOREIGN KEY (plan_document_id) REFERENCES core.document (id) ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TRIGGER asset_item_set_updated_at BEFORE UPDATE ON core.asset_item FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER meter_assignment_set_updated_at BEFORE UPDATE ON core.meter_assignment FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER document_set_updated_at BEFORE UPDATE ON core.document FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
