/**
 * TypeScript mirrors of the PostgreSQL enums in schema `core` (migrations/0002_enums.sql). Values are
 * identical to the API strings. `test/enums.test.ts` proves parity with `pg_enum` after migrating.
 * Additive changes only within a major version (D-153): add values at the end, never rename or drop.
 */
export const TENANT_TYPES = ['apartment', 'condo_juristic', 'pm_company', 'landlord'] as const;
export type TenantType = (typeof TENANT_TYPES)[number];

export const TENANT_LEGAL_FORMS = ['person', 'company', 'juristic_person'] as const;
export type TenantLegalForm = (typeof TENANT_LEGAL_FORMS)[number];

export const TENANT_STATUSES = ['active', 'read_only', 'deactivated'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const DATA_KEY_STATES = ['active', 'decrypt_only', 'destroyed'] as const;
export type DataKeyState = (typeof DATA_KEY_STATES)[number];

export const MEMBERSHIP_STATUSES = ['invited', 'active', 'suspended', 'removed'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const USER_STATUSES = ['active', 'locked', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const IDENTITY_PROVIDERS = ['line', 'line_liff', 'google'] as const;
export type IdentityProvider = (typeof IDENTITY_PROVIDERS)[number];

export const PROPERTY_STATUSES = ['active', 'inactive'] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export const BUILDING_TYPES = ['apartment', 'condo', 'house_cluster', 'mixed_use'] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export const BUILDING_STATUSES = ['active', 'inactive'] as const;
export type BuildingStatus = (typeof BUILDING_STATUSES)[number];

export const OPERATOR_CHANGE_REASONS = [
  'initial',
  'pm_contract_start',
  'pm_contract_end',
  'juristic_formed',
  'handover',
  'other',
] as const;
export type OperatorChangeReason = (typeof OPERATOR_CHANGE_REASONS)[number];

export const UNIT_TYPES = ['room', 'condo_unit', 'house', 'shop', 'parking'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const UNIT_STATUSES = ['vacant', 'occupied', 'reserved', 'maintenance', 'inactive'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const PARTY_TYPES = ['person', 'company'] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const ID_DOCUMENT_TYPES = ['thai_national_id', 'passport', 'other'] as const;
export type IdDocumentType = (typeof ID_DOCUMENT_TYPES)[number];

export const PARTY_LINK_STATES = ['active', 'unlinked'] as const;
export type PartyLinkState = (typeof PARTY_LINK_STATES)[number];

export const PARTY_LINK_VIAS = ['invitation', 'line_match', 'integration', 'admin'] as const;
export type PartyLinkVia = (typeof PARTY_LINK_VIAS)[number];

export const OWNERSHIP_SOURCES = ['manual', 'import', 'getbuild_transfer', 'land_office'] as const;
export type OwnershipSource = (typeof OWNERSHIP_SOURCES)[number];

/** `tenant` here is the occupancy role "lessee" (D-151) — never the SaaS tenant. */
export const OCCUPANCY_ROLES = ['tenant', 'co_tenant', 'owner_occupier', 'family', 'staff'] as const;
export type OccupancyRole = (typeof OCCUPANCY_ROLES)[number];

export const ASSET_CATEGORIES = [
  'meter_electric',
  'meter_water',
  'gateway',
  'lock',
  'breaker',
  'door_controller',
  'camera',
  'sensor',
  'pump',
  'lift',
  'generator',
  'hvac',
  'fire_safety',
  'water_tank',
  'appliance',
  'furniture',
  'other',
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_STATUSES = ['active', 'inactive', 'retired'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const METER_PURPOSES = ['unit', 'common_area', 'main'] as const;
export type MeterPurpose = (typeof METER_PURPOSES)[number];

export const UTILITIES = ['electric', 'water'] as const;
export type Utility = (typeof UTILITIES)[number];

export const METER_CLOSE_REASONS = ['swap', 'unit_merge', 'removed', 'reassigned', 'other'] as const;
export type MeterCloseReason = (typeof METER_CLOSE_REASONS)[number];

export const DOCUMENT_SCOPES = [
  'tenant',
  'property',
  'building',
  'floor',
  'unit',
  'party',
  'asset_item',
  'platform',
] as const;
export type DocumentScope = (typeof DOCUMENT_SCOPES)[number];

export const DOCUMENT_KINDS = [
  'contract',
  'as_built',
  'floor_plan',
  'certificate',
  'warranty',
  'meter_photo',
  'inspection_photo',
  'service_photo',
  'slip',
  'id_document',
  'logo',
  'pdf_invoice',
  'pdf_receipt',
  'pdf_tax_invoice',
  'pdf_note',
  'pdf_statement',
  'pdf_report',
  'utility_invoice',
  'export',
  'ota_artifact',
  'log_bundle',
  'tariff_source',
  'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_SCAN_STATUSES = ['pending', 'clean', 'infected', 'failed', 'skipped'] as const;
export type DocumentScanStatus = (typeof DOCUMENT_SCAN_STATUSES)[number];

export const DOCUMENT_UPLOAD_STATES = ['presigned', 'uploaded', 'verified', 'deleted'] as const;
export type DocumentUploadState = (typeof DOCUMENT_UPLOAD_STATES)[number];

export const GRANT_SCOPES = ['building', 'unit'] as const;
export type GrantScope = (typeof GRANT_SCOPES)[number];

export const GRANT_ACCESSES = ['read', 'write'] as const;
export type GrantAccess = (typeof GRANT_ACCESSES)[number];

export const GRANT_REASONS = [
  'pm_contract',
  'landlord_unit',
  'owner_portal',
  'contractor',
  'developer_post_sale',
  'warranty',
  'juristic_handover',
  'support_other',
] as const;
export type GrantReason = (typeof GRANT_REASONS)[number];

/** Every core enum by its PostgreSQL type name (schema `core`) — used by the parity test and tooling. */
export const CORE_ENUMS: Readonly<Record<string, readonly string[]>> = {
  tenant_type: TENANT_TYPES,
  tenant_legal_form: TENANT_LEGAL_FORMS,
  tenant_status: TENANT_STATUSES,
  data_key_state: DATA_KEY_STATES,
  membership_status: MEMBERSHIP_STATUSES,
  user_status: USER_STATUSES,
  identity_provider: IDENTITY_PROVIDERS,
  property_status: PROPERTY_STATUSES,
  building_type: BUILDING_TYPES,
  building_status: BUILDING_STATUSES,
  operator_change_reason: OPERATOR_CHANGE_REASONS,
  unit_type: UNIT_TYPES,
  unit_status: UNIT_STATUSES,
  party_type: PARTY_TYPES,
  id_document_type: ID_DOCUMENT_TYPES,
  party_link_state: PARTY_LINK_STATES,
  party_link_via: PARTY_LINK_VIAS,
  ownership_source: OWNERSHIP_SOURCES,
  occupancy_role: OCCUPANCY_ROLES,
  asset_category: ASSET_CATEGORIES,
  asset_status: ASSET_STATUSES,
  meter_purpose: METER_PURPOSES,
  utility: UTILITIES,
  meter_close_reason: METER_CLOSE_REASONS,
  document_scope: DOCUMENT_SCOPES,
  document_kind: DOCUMENT_KINDS,
  document_scan_status: DOCUMENT_SCAN_STATUSES,
  document_upload_state: DOCUMENT_UPLOAD_STATES,
  grant_scope: GRANT_SCOPES,
  grant_access: GRANT_ACCESSES,
  grant_reason: GRANT_REASONS,
};
