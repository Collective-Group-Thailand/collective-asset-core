-- collective-asset-core 0005 — parties and their relationships (schema-design v2 §3.1.3): party, party ↔ login
-- link, unit ownership (share), occupancy (who lives there). Deferred FK core.tenant.legal_party_id.

CREATE TABLE core.party (
  id                  uuid NOT NULL DEFAULT uuidv7(),
  tenant_id           uuid NOT NULL,
  type                core.party_type NOT NULL,
  display_name        text NOT NULL,
  first_name          text,
  last_name           text,
  company_name        text,
  tax_id              text,
  phone_e164          text,
  phone_hash          bytea,
  email               citext,
  line_user_id        text,
  language            char(2) NOT NULL DEFAULT 'th',
  nationality         char(2),
  id_document_type    core.id_document_type,
  id_number_enc       bytea,
  id_number_hash      bytea,
  id_document_country char(2),
  id_expires_on       date,
  date_of_birth       date,
  gender              char(1),
  address             jsonb,
  emergency_contact   jsonb,
  notes               text,
  anonymised_at       timestamptz(6),
  source_ref          text,
  created_at          timestamptz(6) NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz(6) NOT NULL DEFAULT now(),
  updated_by          uuid,
  deleted_at          timestamptz(6),
  deleted_by          uuid,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT party_pkey PRIMARY KEY (id),
  CONSTRAINT party_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT party_language_check CHECK (language IN ('th', 'en', 'my', 'km', 'lo', 'zh')),
  CONSTRAINT party_phone_e164_check CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT party_id_number_check CHECK ((id_number_enc IS NULL) = (id_number_hash IS NULL)),
  CONSTRAINT party_gender_check CHECK (gender IS NULL OR gender IN ('M', 'F', 'X'))
);
COMMENT ON TABLE core.party IS 'Any person or company (D-151): lessee, co-owner, co-occupant, technician, guarantor, the tenant''s own legal entity. id_number_enc is AES-256-GCM with the tenant DEK (D-148, §4.7).';
CREATE INDEX party_tenant_id_phone_hash_idx ON core.party (tenant_id, phone_hash);
CREATE INDEX party_tenant_id_id_number_hash_idx ON core.party (tenant_id, id_number_hash);
CREATE INDEX party_tenant_id_line_user_id_idx ON core.party (tenant_id, line_user_id);
CREATE INDEX party_display_name_trgm_idx ON core.party USING gin (display_name gin_trgm_ops);

ALTER TABLE core.tenant
  ADD CONSTRAINT tenant_legal_party_id_fkey FOREIGN KEY (legal_party_id) REFERENCES core.party (id)
  ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE core.party_user_link (
  id            uuid NOT NULL DEFAULT uuidv7(),
  tenant_id     uuid NOT NULL,
  party_id      uuid NOT NULL,
  user_id       uuid NOT NULL,
  identity_id   uuid,
  state         core.party_link_state NOT NULL DEFAULT 'active',
  linked_at     timestamptz(6) NOT NULL DEFAULT now(),
  linked_via    core.party_link_via NOT NULL,
  unlinked_at   timestamptz(6),
  unlinked_by   uuid,
  unlink_reason text,
  created_at    timestamptz(6) NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz(6) NOT NULL DEFAULT now(),
  updated_by    uuid,
  CONSTRAINT party_user_link_pkey PRIMARY KEY (id),
  CONSTRAINT party_user_link_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT party_user_link_party_id_fkey FOREIGN KEY (party_id) REFERENCES core.party (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT party_user_link_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.user_account (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT party_user_link_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES core.user_identity (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT party_user_link_unlinked_check CHECK ((state = 'unlinked') = (unlinked_at IS NOT NULL))
);
COMMENT ON TABLE core.party_user_link IS 'Party ↔ login: one LINE account across many parties and tenants (D-061; event identity.party.linked).';
CREATE UNIQUE INDEX party_user_link_party_id_user_id_key ON core.party_user_link (party_id, user_id) WHERE (state = 'active'::core.party_link_state);
CREATE INDEX party_user_link_user_id_idx ON core.party_user_link (user_id);
CREATE INDEX party_user_link_tenant_id_idx ON core.party_user_link (tenant_id);

CREATE TABLE core.unit_ownership (
  id          uuid NOT NULL DEFAULT uuidv7(),
  tenant_id   uuid NOT NULL,
  building_id uuid NOT NULL,
  unit_id     uuid NOT NULL,
  party_id    uuid NOT NULL,
  share_pct   numeric(7,4) NOT NULL,
  valid_from  date NOT NULL,
  valid_to    date,
  source      core.ownership_source NOT NULL DEFAULT 'manual',
  source_ref  text,
  created_at  timestamptz(6) NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz(6) NOT NULL DEFAULT now(),
  updated_by  uuid,
  CONSTRAINT unit_ownership_pkey PRIMARY KEY (id),
  CONSTRAINT unit_ownership_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT unit_ownership_building_id_fkey FOREIGN KEY (building_id) REFERENCES core.building (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT unit_ownership_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES core.unit (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT unit_ownership_party_id_fkey FOREIGN KEY (party_id) REFERENCES core.party (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT unit_ownership_share_pct_check CHECK (share_pct > 0 AND share_pct <= 100),
  CONSTRAINT unit_ownership_range_check CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT unit_ownership_no_overlap EXCLUDE USING gist (unit_id WITH =, party_id WITH =, daterange(valid_from, valid_to) WITH &&)
);
COMMENT ON TABLE core.unit_ownership IS 'Who owns a unit, with share_pct (condo co-owners, landlords; apartments: one row = the tenant''s legal party). Σ share_pct per unit per day ≤ 100 (deferred constraint trigger).';
CREATE INDEX unit_ownership_party_id_idx ON core.unit_ownership (party_id);
CREATE INDEX unit_ownership_tenant_id_building_id_idx ON core.unit_ownership (tenant_id, building_id);
CREATE INDEX unit_ownership_unit_id_idx ON core.unit_ownership (unit_id);

-- Σ share_pct of the rows of one unit that are valid on any single day must stay ≤ 100. The maximum of a sum
-- of overlapping ranges is reached at the start of one of them, so it is enough to test every start date.
-- Deferred to commit so a transfer (close one owner, open two) can be written in any order.
CREATE OR REPLACE FUNCTION core.check_unit_ownership_share() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  worst numeric;
  worst_day date;
BEGIN
  SELECT s.total, s.day INTO worst, worst_day
    FROM (SELECT d.day,
                 (SELECT sum(b.share_pct) FROM core.unit_ownership b
                   WHERE b.unit_id = NEW.unit_id AND daterange(b.valid_from, b.valid_to) @> d.day) AS total
            FROM (SELECT DISTINCT a.valid_from AS day FROM core.unit_ownership a WHERE a.unit_id = NEW.unit_id) d) s
   ORDER BY s.total DESC LIMIT 1;
  IF worst > 100 THEN
    RAISE EXCEPTION 'core.ownership_share_exceeded: ownership shares of unit % sum to % on % (maximum 100)', NEW.unit_id, worst, worst_day
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER unit_ownership_share_sum AFTER INSERT OR UPDATE ON core.unit_ownership
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.check_unit_ownership_share();

CREATE TABLE core.occupancy (
  id           uuid NOT NULL DEFAULT uuidv7(),
  tenant_id    uuid NOT NULL,
  building_id  uuid NOT NULL,
  unit_id      uuid NOT NULL,
  party_id     uuid NOT NULL,
  role         core.occupancy_role NOT NULL,
  lease_id     uuid,
  valid_from   date NOT NULL,
  valid_to     date,
  moved_in_at  timestamptz(6),
  moved_out_at timestamptz(6),
  created_at   timestamptz(6) NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz(6) NOT NULL DEFAULT now(),
  updated_by   uuid,
  CONSTRAINT occupancy_pkey PRIMARY KEY (id),
  CONSTRAINT occupancy_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT occupancy_building_id_fkey FOREIGN KEY (building_id) REFERENCES core.building (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT occupancy_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES core.unit (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT occupancy_party_id_fkey FOREIGN KEY (party_id) REFERENCES core.party (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT occupancy_range_check CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT occupancy_no_overlap EXCLUDE USING gist (unit_id WITH =, party_id WITH =, daterange(valid_from, valid_to) WITH &&)
);
COMMENT ON TABLE core.occupancy IS 'Who actually lives in a unit, separate from contracts. role tenant = the lessee (D-151), never the SaaS tenant. lease_id is a logical reference to the app (core never references app schemas).';
CREATE INDEX occupancy_party_id_idx ON core.occupancy (party_id);
CREATE INDEX occupancy_tenant_id_building_id_unit_id_idx ON core.occupancy (tenant_id, building_id, unit_id);

CREATE TRIGGER party_set_updated_at BEFORE UPDATE ON core.party FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER party_user_link_set_updated_at BEFORE UPDATE ON core.party_user_link FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER unit_ownership_set_updated_at BEFORE UPDATE ON core.unit_ownership FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER occupancy_set_updated_at BEFORE UPDATE ON core.occupancy FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
