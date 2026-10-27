import type {
  AssetCategory,
  AssetStatus,
  BuildingStatus,
  BuildingType,
  DataKeyState,
  DocumentKind,
  DocumentScanStatus,
  DocumentScope,
  DocumentUploadState,
  GrantAccess,
  GrantReason,
  GrantScope,
  IdDocumentType,
  IdentityProvider,
  MembershipStatus,
  MeterCloseReason,
  MeterPurpose,
  OccupancyRole,
  OperatorChangeReason,
  OwnershipSource,
  PartyLinkState,
  PartyLinkVia,
  PartyType,
  PropertyStatus,
  TenantLegalForm,
  TenantStatus,
  TenantType,
  UnitStatus,
  UnitType,
  UserStatus,
  Utility,
} from './enums.js';

/**
 * Row shapes of the 18 `core` tables as `pg` returns them (snake_case column names). Conventions:
 * `uuid` → string; `timestamptz` → Date; `date` → 'YYYY-MM-DD' string (call `configurePgTypes()` so `pg`
 * does not turn dates into local-midnight Date objects); `numeric` → decimal string (never a JS number,
 * D-046); `bigint` → string; `bytea` → Buffer; `jsonb` → parsed JSON. Prisma users get the generated
 * Prisma types from prisma/core.prisma instead.
 */
export type Uuid = string;
export type DecimalString = string;
export type IsoDate = string;
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

interface Audit {
  created_at: Date;
  created_by: Uuid | null;
  updated_at: Date;
  updated_by: Uuid | null;
}
interface SoftDelete {
  deleted_at: Date | null;
  deleted_by: Uuid | null;
}

export interface Address {
  line1?: string;
  line2?: string;
  subdistrict?: string;
  district?: string;
  province?: string;
  postcode?: string;
  country?: string;
}

export interface TenantRow extends Audit, SoftDelete {
  id: Uuid;
  type: TenantType;
  slug: string;
  display_name: string;
  legal_name: string;
  legal_form: TenantLegalForm;
  tax_id: string | null;
  vat_registered: boolean;
  address: Address;
  logo_document_id: Uuid | null;
  plan: string | null;
  settings: Record<string, Json>;
  default_language: string;
  timezone: string;
  status: TenantStatus;
  deactivated_reason: string | null;
  legal_party_id: Uuid | null;
  source_ref: string | null;
  version: number;
}

export interface TenantDataKeyRow {
  id: Uuid;
  tenant_id: Uuid;
  kid: number;
  wrapped_dek: Buffer;
  kek_ref: string;
  algorithm: string;
  state: DataKeyState;
  created_at: Date;
  rotated_at: Date | null;
  destroyed_at: Date | null;
}

/** `module_scopes` of a membership (D-090): null = all modules / all buildings. */
export interface ModuleScopes {
  modules?: string[] | null;
  buildingIds?: Uuid[] | null;
}

export interface MembershipRow extends Audit, SoftDelete {
  id: Uuid;
  tenant_id: Uuid;
  user_id: Uuid;
  role: string;
  module_scopes: ModuleScopes;
  status: MembershipStatus;
  joined_at: Date | null;
  removed_at: Date | null;
  removed_reason: string | null;
}

export interface UserAccountRow extends Audit {
  id: Uuid;
  email: string | null;
  email_verified_at: Date | null;
  phone_e164: string | null;
  phone_hash: Buffer | null;
  phone_verified_at: Date | null;
  line_user_id: string | null;
  display_name: string;
  language: string;
  timezone: string;
  status: UserStatus;
  disabled_at: Date | null;
  disabled_reason: string | null;
  last_login_at: Date | null;
  version: number;
}

export interface UserIdentityRow extends Audit {
  id: Uuid;
  user_id: Uuid;
  provider: IdentityProvider;
  provider_subject: string;
  display_name: string | null;
  picture_url: string | null;
  linked_at: Date;
  last_seen_at: Date | null;
  raw_claims: Record<string, Json>;
}

export interface PropertyRow extends Audit, SoftDelete {
  id: Uuid;
  tenant_id: Uuid;
  code: string;
  name: string;
  address: Address;
  province_code: string | null;
  lat: DecimalString | null;
  lng: DecimalString | null;
  status: PropertyStatus;
  source_ref: string | null;
  version: number;
}

export interface BuildingRow extends Audit, SoftDelete {
  id: Uuid;
  tenant_id: Uuid;
  property_id: Uuid;
  code: string;
  name: string;
  type: BuildingType;
  floors_count: number | null;
  address: Address | null;
  owner_tenant_id: Uuid | null;
  /** Null only for an external stub (a condo not on the platform yet, 0.5.0). */
  operator_tenant_id: Uuid | null;
  registration_no: string | null;
  handed_over_at: Date | null;
  source_ref: string | null;
  unit_count_cached: number;
  status: BuildingStatus;
  version: number;
}

export interface BuildingOperatorPeriodRow extends Audit {
  id: Uuid;
  tenant_id: Uuid;
  building_id: Uuid;
  owner_tenant_id: Uuid | null;
  operator_tenant_id: Uuid;
  valid_from: Date;
  valid_to: Date | null;
  reason: OperatorChangeReason;
  source_ref: string | null;
}

export interface FloorRow extends Audit, SoftDelete {
  id: Uuid;
  tenant_id: Uuid;
  building_id: Uuid;
  level: number;
  name: string;
  sort_order: number;
  plan_document_id: Uuid | null;
}

export interface UnitRow extends Audit, SoftDelete {
  id: Uuid;
  tenant_id: Uuid;
  building_id: Uuid;
  property_id: Uuid;
  floor_id: Uuid | null;
  unit_no: string;
  type: UnitType;
  area_sqm: DecimalString | null;
  ownership_ratio: DecimalString | null;
  status: UnitStatus;
  status_changed_at: Date;
  base_rent: DecimalString | null;
  title_deed_no: string | null;
  source_ref: string | null;
  version: number;
}

export interface PartyRow extends Audit, SoftDelete {
  id: Uuid;
  tenant_id: Uuid;
  type: PartyType;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  tax_id: string | null;
  phone_e164: string | null;
  phone_hash: Buffer | null;
  email: string | null;
  line_user_id: string | null;
  language: string;
  nationality: string | null;
  id_document_type: IdDocumentType | null;
  id_number_enc: Buffer | null;
  id_number_hash: Buffer | null;
  id_document_country: string | null;
  id_expires_on: IsoDate | null;
  date_of_birth: IsoDate | null;
  gender: string | null;
  address: Address | null;
  emergency_contact: { name?: string; relation?: string; phoneEnc?: string } | null;
  notes: string | null;
  anonymised_at: Date | null;
  source_ref: string | null;
  version: number;
}

export interface PartyUserLinkRow extends Audit {
  id: Uuid;
  tenant_id: Uuid;
  party_id: Uuid;
  user_id: Uuid;
  identity_id: Uuid | null;
  state: PartyLinkState;
  linked_at: Date;
  linked_via: PartyLinkVia;
  unlinked_at: Date | null;
  unlinked_by: Uuid | null;
  unlink_reason: string | null;
}

export interface UnitOwnershipRow extends Audit {
  id: Uuid;
  tenant_id: Uuid;
  building_id: Uuid;
  unit_id: Uuid;
  party_id: Uuid;
  share_pct: DecimalString;
  valid_from: IsoDate;
  valid_to: IsoDate | null;
  source: OwnershipSource;
  source_ref: string | null;
}

export interface OccupancyRow extends Audit {
  id: Uuid;
  tenant_id: Uuid;
  building_id: Uuid;
  unit_id: Uuid;
  party_id: Uuid;
  role: OccupancyRole;
  lease_id: Uuid | null;
  valid_from: IsoDate;
  valid_to: IsoDate | null;
  moved_in_at: Date | null;
  moved_out_at: Date | null;
}

export interface AssetItemRow extends Audit, SoftDelete {
  id: Uuid;
  tenant_id: Uuid;
  building_id: Uuid;
  floor_id: Uuid | null;
  unit_id: Uuid | null;
  category: AssetCategory;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serial: string | null;
  qr_code: string | null;
  location: string | null;
  install_date: IsoDate | null;
  expected_life_years: DecimalString | null;
  warranty_until: IsoDate | null;
  warranty_party_id: Uuid | null;
  status: AssetStatus;
  retired_at: Date | null;
  retired_reason: string | null;
  meta: Record<string, Json>;
  source_ref: string | null;
}

export interface MeterAssignmentRow extends Audit {
  id: Uuid;
  tenant_id: Uuid;
  building_id: Uuid;
  asset_item_id: Uuid;
  unit_id: Uuid | null;
  purpose: MeterPurpose;
  utility: Utility;
  code: string;
  common_area_label: string | null;
  valid_from: Date;
  valid_to: Date | null;
  multiplier: DecimalString;
  initial_reading: DecimalString;
  final_reading: DecimalString | null;
  rollover_at: DecimalString;
  close_reason: MeterCloseReason | null;
}

export interface DocumentRow extends Audit, SoftDelete {
  id: Uuid;
  tenant_id: Uuid | null;
  scope_type: DocumentScope;
  scope_id: Uuid | null;
  building_id: Uuid | null;
  kind: DocumentKind;
  title: string | null;
  storage_bucket: string;
  storage_key: string;
  mime_type: string;
  size_bytes: string;
  sha256: Buffer;
  width: number | null;
  height: number | null;
  version_of_document_id: Uuid | null;
  version_no: number;
  retention_class: string;
  expires_at: Date | null;
  scan_status: DocumentScanStatus;
  scanned_at: Date | null;
  upload_state: DocumentUploadState;
  uploaded_at: Date | null;
  thumbnail_key: string | null;
  source_ref: string | null;
  delete_reason: string | null;
  /** 0013: legal hold placed by the app (D-286); no delete while in force. */
  legal_hold: boolean;
  /** 0013: end of the hold; null while held = open-ended. */
  legal_hold_until: Date | null;
}

export interface AssetAccessGrantRow extends Audit {
  id: Uuid;
  tenant_id: Uuid;
  grantee_tenant_id: Uuid;
  building_id: Uuid;
  unit_id: Uuid | null;
  scope: GrantScope;
  modules: string[];
  access: GrantAccess;
  reason: GrantReason;
  valid_from: Date;
  valid_to: Date | null;
  revoked_at: Date | null;
  revoked_by: Uuid | null;
  revoke_reason: string | null;
  source_ref: string | null;
}

/** Table name (schema `core`) → row type. */
export interface CoreTables {
  tenant: TenantRow;
  tenant_data_key: TenantDataKeyRow;
  membership: MembershipRow;
  user_account: UserAccountRow;
  user_identity: UserIdentityRow;
  property: PropertyRow;
  building: BuildingRow;
  building_operator_period: BuildingOperatorPeriodRow;
  floor: FloorRow;
  unit: UnitRow;
  party: PartyRow;
  party_user_link: PartyUserLinkRow;
  unit_ownership: UnitOwnershipRow;
  occupancy: OccupancyRow;
  asset_item: AssetItemRow;
  meter_assignment: MeterAssignmentRow;
  document: DocumentRow;
  asset_access_grant: AssetAccessGrantRow;
}

/** The 18 tables of v0.1.0 (schema-design v2 §7.1). */
export const CORE_TABLES = [
  'tenant',
  'tenant_data_key',
  'membership',
  'user_account',
  'user_identity',
  'property',
  'building',
  'building_operator_period',
  'floor',
  'unit',
  'party',
  'party_user_link',
  'unit_ownership',
  'occupancy',
  'asset_item',
  'meter_assignment',
  'document',
  'asset_access_grant',
] as const satisfies readonly (keyof CoreTables)[];
export type CoreTable = (typeof CORE_TABLES)[number];
