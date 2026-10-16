-- collective-asset-core 0002 — PostgreSQL enums of the core schema (schema-design v2 §1.2 "Enums", §3.1).
-- Values are snake_case and identical to the API strings. Additions are ALTER TYPE … ADD VALUE in a later
-- migration (additive = allowed within a major version, D-153); renames and drops need a new major.

CREATE TYPE core.tenant_type AS ENUM ('apartment', 'condo_juristic', 'pm_company', 'landlord');
CREATE TYPE core.tenant_legal_form AS ENUM ('person', 'company', 'juristic_person');
CREATE TYPE core.tenant_status AS ENUM ('active', 'read_only', 'deactivated');
CREATE TYPE core.data_key_state AS ENUM ('active', 'decrypt_only', 'destroyed');
CREATE TYPE core.membership_status AS ENUM ('invited', 'active', 'suspended', 'removed');
CREATE TYPE core.user_status AS ENUM ('active', 'locked', 'disabled');
CREATE TYPE core.identity_provider AS ENUM ('line', 'line_liff', 'google');
CREATE TYPE core.property_status AS ENUM ('active', 'inactive');
CREATE TYPE core.building_type AS ENUM ('apartment', 'condo', 'house_cluster', 'mixed_use');
CREATE TYPE core.building_status AS ENUM ('active', 'inactive');
CREATE TYPE core.operator_change_reason AS ENUM ('initial', 'pm_contract_start', 'pm_contract_end', 'juristic_formed', 'handover', 'other');
CREATE TYPE core.unit_type AS ENUM ('room', 'condo_unit', 'house', 'shop', 'parking');
CREATE TYPE core.unit_status AS ENUM ('vacant', 'occupied', 'reserved', 'maintenance', 'inactive');
CREATE TYPE core.party_type AS ENUM ('person', 'company');
CREATE TYPE core.id_document_type AS ENUM ('thai_national_id', 'passport', 'other');
CREATE TYPE core.party_link_state AS ENUM ('active', 'unlinked');
CREATE TYPE core.party_link_via AS ENUM ('invitation', 'line_match', 'integration', 'admin');
CREATE TYPE core.ownership_source AS ENUM ('manual', 'import', 'getbuild_transfer', 'land_office');
CREATE TYPE core.occupancy_role AS ENUM ('tenant', 'co_tenant', 'owner_occupier', 'family', 'staff');
CREATE TYPE core.asset_category AS ENUM (
  'meter_electric', 'meter_water', 'gateway', 'lock', 'breaker', 'door_controller', 'camera', 'sensor', 'pump', 'lift',
  'generator', 'hvac', 'fire_safety', 'water_tank', 'appliance', 'furniture', 'other');
CREATE TYPE core.asset_status AS ENUM ('active', 'inactive', 'retired');
CREATE TYPE core.meter_purpose AS ENUM ('unit', 'common_area', 'main');
CREATE TYPE core.utility AS ENUM ('electric', 'water');
CREATE TYPE core.meter_close_reason AS ENUM ('swap', 'unit_merge', 'removed', 'reassigned', 'other');
CREATE TYPE core.document_scope AS ENUM ('tenant', 'property', 'building', 'floor', 'unit', 'party', 'asset_item', 'platform');
CREATE TYPE core.document_kind AS ENUM (
  'contract', 'as_built', 'floor_plan', 'certificate', 'warranty', 'meter_photo', 'inspection_photo', 'service_photo', 'slip',
  'id_document', 'logo', 'pdf_invoice', 'pdf_receipt', 'pdf_tax_invoice', 'pdf_note', 'pdf_statement', 'pdf_report',
  'utility_invoice', 'export', 'ota_artifact', 'log_bundle', 'tariff_source', 'other');
CREATE TYPE core.document_scan_status AS ENUM ('pending', 'clean', 'infected', 'failed', 'skipped');
CREATE TYPE core.document_upload_state AS ENUM ('presigned', 'uploaded', 'verified', 'deleted');
CREATE TYPE core.grant_scope AS ENUM ('building', 'unit');
CREATE TYPE core.grant_access AS ENUM ('read', 'write');
CREATE TYPE core.grant_reason AS ENUM (
  'pm_contract', 'landlord_unit', 'owner_portal', 'contractor', 'developer_post_sale', 'warranty', 'juristic_handover', 'support_other');
