-- collective-asset-core 0004 — asset hierarchy property → building (owner vs operator) → floor → unit
-- (schema-design v2 §3.1.2, §4.6). Apartment: building.owner_tenant_id = operator_tenant_id = tenant_id.

CREATE TABLE core.property (
  id            uuid NOT NULL DEFAULT uuidv7(),
  tenant_id     uuid NOT NULL,
  code          citext NOT NULL,
  name          text NOT NULL,
  address       jsonb NOT NULL DEFAULT '{}',
  province_code text,
  lat           numeric(9,6),
  lng           numeric(9,6),
  status        core.property_status NOT NULL DEFAULT 'active',
  source_ref    text,
  created_at    timestamptz(6) NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz(6) NOT NULL DEFAULT now(),
  updated_by    uuid,
  deleted_at    timestamptz(6),
  deleted_by    uuid,
  version       integer NOT NULL DEFAULT 1,
  CONSTRAINT property_pkey PRIMARY KEY (id),
  CONSTRAINT property_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT property_lat_check CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  CONSTRAINT property_lng_check CHECK (lng IS NULL OR lng BETWEEN -180 AND 180)
);
COMMENT ON TABLE core.property IS 'A group of buildings managed together (getbuild: project); tenant_id = the operator tenant.';
CREATE UNIQUE INDEX property_tenant_id_code_key ON core.property (tenant_id, code) WHERE (deleted_at IS NULL);
CREATE INDEX property_tenant_id_status_idx ON core.property (tenant_id, status);
CREATE INDEX property_name_trgm_idx ON core.property USING gin (name gin_trgm_ops);

CREATE TABLE core.building (
  id                 uuid NOT NULL DEFAULT uuidv7(),
  tenant_id          uuid NOT NULL,
  property_id        uuid NOT NULL,
  code               citext NOT NULL,
  name               text NOT NULL,
  type               core.building_type NOT NULL,
  floors_count       smallint,
  address            jsonb,
  owner_tenant_id    uuid,
  operator_tenant_id uuid NOT NULL,
  registration_no    text,
  handed_over_at     timestamptz(6),
  source_ref         text,
  unit_count_cached  integer NOT NULL DEFAULT 0,
  status             core.building_status NOT NULL DEFAULT 'active',
  created_at         timestamptz(6) NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz(6) NOT NULL DEFAULT now(),
  updated_by         uuid,
  deleted_at         timestamptz(6),
  deleted_by         uuid,
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT building_pkey PRIMARY KEY (id),
  CONSTRAINT building_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT building_property_id_fkey FOREIGN KEY (property_id) REFERENCES core.property (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT building_owner_tenant_id_fkey FOREIGN KEY (owner_tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT building_operator_tenant_id_fkey FOREIGN KEY (operator_tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT building_floors_count_check CHECK (floors_count IS NULL OR floors_count >= 0),
  CONSTRAINT building_unit_count_cached_check CHECK (unit_count_cached >= 0)
);
COMMENT ON TABLE core.building IS 'The unit of operation. tenant_id = data-owner tenant; owner_tenant_id (null during a developer post-sale period) vs operator_tenant_id (§4.6).';
CREATE UNIQUE INDEX building_property_id_code_key ON core.building (property_id, code) WHERE (deleted_at IS NULL);
CREATE INDEX building_operator_tenant_id_idx ON core.building (operator_tenant_id);
CREATE INDEX building_owner_tenant_id_idx ON core.building (owner_tenant_id);
CREATE INDEX building_tenant_id_idx ON core.building (tenant_id);
CREATE UNIQUE INDEX building_source_ref_key ON core.building (source_ref) WHERE (source_ref IS NOT NULL);

CREATE TABLE core.building_operator_period (
  id                 uuid NOT NULL DEFAULT uuidv7(),
  tenant_id          uuid NOT NULL,
  building_id        uuid NOT NULL,
  owner_tenant_id    uuid,
  operator_tenant_id uuid NOT NULL,
  valid_from         timestamptz(6) NOT NULL,
  valid_to           timestamptz(6),
  reason             core.operator_change_reason NOT NULL,
  source_ref         text,
  created_at         timestamptz(6) NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz(6) NOT NULL DEFAULT now(),
  updated_by         uuid,
  CONSTRAINT building_operator_period_pkey PRIMARY KEY (id),
  CONSTRAINT building_operator_period_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT building_operator_period_building_id_fkey FOREIGN KEY (building_id) REFERENCES core.building (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT building_operator_period_owner_tenant_id_fkey FOREIGN KEY (owner_tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT building_operator_period_operator_tenant_id_fkey FOREIGN KEY (operator_tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT building_operator_period_range_check CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT building_operator_period_no_overlap EXCLUDE USING gist (building_id WITH =, tstzrange(valid_from, valid_to) WITH &&)
);
COMMENT ON TABLE core.building_operator_period IS 'History of owner/operator per building; an operator change opens a new period (no data copy). Closed rows are immutable.';
CREATE INDEX building_operator_period_building_id_valid_from_idx ON core.building_operator_period (building_id, valid_from);

CREATE TABLE core.floor (
  id               uuid NOT NULL DEFAULT uuidv7(),
  tenant_id        uuid NOT NULL,
  building_id      uuid NOT NULL,
  level            smallint NOT NULL,
  name             text NOT NULL,
  sort_order       smallint NOT NULL DEFAULT 0,
  plan_document_id uuid,
  created_at       timestamptz(6) NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz(6) NOT NULL DEFAULT now(),
  updated_by       uuid,
  deleted_at       timestamptz(6),
  deleted_by       uuid,
  CONSTRAINT floor_pkey PRIMARY KEY (id),
  CONSTRAINT floor_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT floor_building_id_fkey FOREIGN KEY (building_id) REFERENCES core.building (id) ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX floor_building_id_level_key ON core.floor (building_id, level) WHERE (deleted_at IS NULL);
CREATE INDEX floor_tenant_id_building_id_idx ON core.floor (tenant_id, building_id);

CREATE TABLE core.unit (
  id                uuid NOT NULL DEFAULT uuidv7(),
  tenant_id         uuid NOT NULL,
  building_id       uuid NOT NULL,
  property_id       uuid NOT NULL,
  floor_id          uuid,
  unit_no           citext NOT NULL,
  type              core.unit_type NOT NULL DEFAULT 'room',
  area_sqm          numeric(9,2),
  ownership_ratio   numeric(9,6),
  status            core.unit_status NOT NULL DEFAULT 'vacant',
  status_changed_at timestamptz(6) NOT NULL DEFAULT now(),
  base_rent         numeric(14,2),
  title_deed_no     text,
  source_ref        text,
  created_at        timestamptz(6) NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz(6) NOT NULL DEFAULT now(),
  updated_by        uuid,
  deleted_at        timestamptz(6),
  deleted_by        uuid,
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT unit_pkey PRIMARY KEY (id),
  CONSTRAINT unit_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT unit_building_id_fkey FOREIGN KEY (building_id) REFERENCES core.building (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT unit_property_id_fkey FOREIGN KEY (property_id) REFERENCES core.property (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT unit_floor_id_fkey FOREIGN KEY (floor_id) REFERENCES core.floor (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT unit_area_sqm_check CHECK (area_sqm IS NULL OR area_sqm > 0),
  CONSTRAINT unit_ownership_ratio_check CHECK (ownership_ratio IS NULL OR (ownership_ratio > 0 AND ownership_ratio <= 1)),
  CONSTRAINT unit_base_rent_check CHECK (base_rent IS NULL OR (base_rent >= 0 AND base_rent = round(base_rent, 2)))
);
COMMENT ON TABLE core.unit IS 'Room / condo unit / house / shop / parking (D-151). D-082/D-156 counting = status <> inactive and deleted_at null on the 1st of the month.';
CREATE UNIQUE INDEX unit_building_id_unit_no_key ON core.unit (building_id, unit_no) WHERE (deleted_at IS NULL);
CREATE INDEX unit_tenant_id_building_id_status_idx ON core.unit (tenant_id, building_id, status);
CREATE INDEX unit_unit_no_trgm_idx ON core.unit USING gin (unit_no gin_trgm_ops);
CREATE INDEX unit_floor_id_idx ON core.unit (floor_id);

CREATE TRIGGER property_set_updated_at BEFORE UPDATE ON core.property FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER building_set_updated_at BEFORE UPDATE ON core.building FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER building_operator_period_set_updated_at BEFORE UPDATE ON core.building_operator_period FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER building_operator_period_close_previous BEFORE INSERT ON core.building_operator_period
  FOR EACH ROW EXECUTE FUNCTION core.close_previous_period('building_id', 'valid_from', 'valid_to');
CREATE TRIGGER building_operator_period_append_only BEFORE UPDATE OR DELETE ON core.building_operator_period
  FOR EACH ROW EXECUTE FUNCTION core.deny_mutation('valid_to');
CREATE TRIGGER floor_set_updated_at BEFORE UPDATE ON core.floor FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER unit_set_updated_at BEFORE UPDATE ON core.unit FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
