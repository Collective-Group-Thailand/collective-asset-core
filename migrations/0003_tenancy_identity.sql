-- collective-asset-core 0003 — tenancy & identity (schema-design v2 §3.1.1).
-- Index and constraint names follow Prisma's defaults (<table>_<cols>_key|_idx|_fkey, <table>_pkey) so the
-- Prisma fragment (prisma/core.prisma) and the database agree name for name.

CREATE TABLE core.tenant (
  id                 uuid NOT NULL DEFAULT uuidv7(),
  type               core.tenant_type NOT NULL DEFAULT 'apartment',
  slug               citext NOT NULL,
  display_name       text NOT NULL,
  legal_name         text NOT NULL,
  legal_form         core.tenant_legal_form NOT NULL,
  tax_id             text,
  vat_registered     boolean NOT NULL DEFAULT false,
  address            jsonb NOT NULL DEFAULT '{}',
  logo_document_id   uuid,
  plan               text,
  settings           jsonb NOT NULL DEFAULT '{}',
  default_language   char(2) NOT NULL DEFAULT 'th',
  timezone           text NOT NULL DEFAULT 'Asia/Bangkok',
  status             core.tenant_status NOT NULL DEFAULT 'active',
  deactivated_reason text,
  legal_party_id     uuid,
  source_ref         text,
  created_at         timestamptz(6) NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz(6) NOT NULL DEFAULT now(),
  updated_by         uuid,
  deleted_at         timestamptz(6),
  deleted_by         uuid,
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT tenant_pkey PRIMARY KEY (id),
  CONSTRAINT tenant_tax_id_check CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{13}$'),
  CONSTRAINT tenant_default_language_check CHECK (default_language ~ '^[a-z]{2}$'),
  CONSTRAINT tenant_version_check CHECK (version >= 1)
);
COMMENT ON TABLE core.tenant IS 'The paying customer organisation (D-151); tenancy root. status read_only mirrors platform.subscription suspended (D-082).';
CREATE UNIQUE INDEX tenant_slug_key ON core.tenant (slug);
CREATE INDEX tenant_type_status_idx ON core.tenant (type, status);
CREATE INDEX tenant_display_name_trgm_idx ON core.tenant USING gin (display_name gin_trgm_ops);

CREATE TABLE core.tenant_data_key (
  id           uuid NOT NULL DEFAULT uuidv7(),
  tenant_id    uuid NOT NULL,
  kid          smallint NOT NULL,
  wrapped_dek  bytea NOT NULL,
  kek_ref      text NOT NULL,
  algorithm    text NOT NULL DEFAULT 'AES-256-GCM',
  state        core.data_key_state NOT NULL DEFAULT 'active',
  created_at   timestamptz(6) NOT NULL DEFAULT now(),
  rotated_at   timestamptz(6),
  destroyed_at timestamptz(6),
  CONSTRAINT tenant_data_key_pkey PRIMARY KEY (id),
  CONSTRAINT tenant_data_key_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT tenant_data_key_kid_check CHECK (kid BETWEEN 1 AND 32767),
  CONSTRAINT tenant_data_key_destroyed_check CHECK ((state = 'destroyed') = (destroyed_at IS NOT NULL))
);
COMMENT ON TABLE core.tenant_data_key IS 'Per-tenant data-encryption keys (wrapped by the KMS KEK) for PII columns (blueprint rule 5, §4.7). Readable by gp_app only through core.tenant_dek().';
CREATE UNIQUE INDEX tenant_data_key_tenant_id_kid_key ON core.tenant_data_key (tenant_id, kid);
CREATE UNIQUE INDEX tenant_data_key_tenant_id_active_key ON core.tenant_data_key (tenant_id) WHERE (state = 'active'::core.data_key_state);

CREATE TABLE core.user_account (
  id                uuid NOT NULL DEFAULT uuidv7(),
  email             citext,
  email_verified_at timestamptz(6),
  phone_e164        text,
  phone_hash        bytea,
  phone_verified_at timestamptz(6),
  line_user_id      text,
  display_name      text NOT NULL,
  language          char(2) NOT NULL DEFAULT 'th',
  timezone          text NOT NULL DEFAULT 'Asia/Bangkok',
  status            core.user_status NOT NULL DEFAULT 'active',
  disabled_at       timestamptz(6),
  disabled_reason   text,
  last_login_at     timestamptz(6),
  created_at        timestamptz(6) NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz(6) NOT NULL DEFAULT now(),
  updated_by        uuid,
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT user_account_pkey PRIMARY KEY (id),
  CONSTRAINT user_account_contact_check CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL OR line_user_id IS NOT NULL),
  CONSTRAINT user_account_phone_e164_check CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT user_account_version_check CHECK (version >= 1)
);
COMMENT ON TABLE core.user_account IS 'A login (a user is not a party). Phone in clear + HMAC hash, redacted in logs (D-148). Credentials live in the app (platform.user_credential).';
CREATE UNIQUE INDEX user_account_email_key ON core.user_account (email);
CREATE UNIQUE INDEX user_account_phone_hash_key ON core.user_account (phone_hash);
CREATE UNIQUE INDEX user_account_line_user_id_key ON core.user_account (line_user_id);

CREATE TABLE core.user_identity (
  id               uuid NOT NULL DEFAULT uuidv7(),
  user_id          uuid NOT NULL,
  provider         core.identity_provider NOT NULL,
  provider_subject text NOT NULL,
  display_name     text,
  picture_url      text,
  linked_at        timestamptz(6) NOT NULL DEFAULT now(),
  last_seen_at     timestamptz(6),
  raw_claims       jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz(6) NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz(6) NOT NULL DEFAULT now(),
  updated_by       uuid,
  CONSTRAINT user_identity_pkey PRIMARY KEY (id),
  CONSTRAINT user_identity_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.user_account (id) ON DELETE RESTRICT ON UPDATE NO ACTION
);
COMMENT ON TABLE core.user_identity IS 'External identities (LINE for residents/technicians/owners); raw_claims minimised.';
CREATE UNIQUE INDEX user_identity_provider_provider_subject_key ON core.user_identity (provider, provider_subject);
CREATE INDEX user_identity_user_id_idx ON core.user_identity (user_id);

CREATE TABLE core.membership (
  id             uuid NOT NULL DEFAULT uuidv7(),
  tenant_id      uuid NOT NULL,
  user_id        uuid NOT NULL,
  role           text NOT NULL,
  module_scopes  jsonb NOT NULL DEFAULT '{}',
  status         core.membership_status NOT NULL DEFAULT 'invited',
  joined_at      timestamptz(6),
  removed_at     timestamptz(6),
  removed_reason text,
  created_at     timestamptz(6) NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz(6) NOT NULL DEFAULT now(),
  updated_by     uuid,
  deleted_at     timestamptz(6),
  deleted_by     uuid,
  CONSTRAINT membership_pkey PRIMARY KEY (id),
  CONSTRAINT membership_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenant (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT membership_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.user_account (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT membership_role_check CHECK (role ~ '^[a-z][a-z0-9_]*$')
);
COMMENT ON TABLE core.membership IS 'A user working for a tenant (operator audience). role = tenant role key validated against the app catalogue; module_scopes = {"modules": [...] | null, "buildingIds": [...] | null} (D-090).';
CREATE UNIQUE INDEX membership_tenant_id_user_id_key ON core.membership (tenant_id, user_id) WHERE (deleted_at IS NULL);
CREATE INDEX membership_user_id_idx ON core.membership (user_id);

CREATE TRIGGER tenant_set_updated_at BEFORE UPDATE ON core.tenant FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER user_account_set_updated_at BEFORE UPDATE ON core.user_account FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER user_identity_set_updated_at BEFORE UPDATE ON core.user_identity FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER membership_set_updated_at BEFORE UPDATE ON core.membership FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
