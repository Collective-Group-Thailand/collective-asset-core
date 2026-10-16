import { z } from 'zod';

/** RFC 9562 uuid (any version; ids are uuidv7 per D-152). */
export const Uuid = z.uuid().describe('uuid');
/** Decimal money string, THB, at most 2 decimals (D-046): "1234.50". */
export const Money = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, 'money must be a decimal string with at most 2 decimals')
  .describe('decimal string, THB');
/** Decimal quantity string with up to 6 decimals ("12.500", "0.012345"). */
export const DecimalString = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,6})?$/, 'must be a decimal string')
  .describe('decimal string');
export const IsoDateTime = z.iso.datetime({ offset: true }).describe('ISO 8601 date-time with offset');
export const IsoDate = z.iso.date().describe('ISO 8601 date (YYYY-MM-DD)');
export const HttpsUrl = z.url({ protocol: /^https$/ }).describe('https URL (signed, time-limited for files)');
/** Reference to a row in the *source* platform (its own id or business key), e.g. a getbuild unit id. */
export const SourceRef = z.string().min(1).max(200).describe('id of the row in the source platform');

/**
 * PII travels encrypted with the Collective shared integration key (KMS, D-160, blueprint "Integration
 * contracts"): `{ "enc": "<base64 envelope>" }`. The consumer decrypts and re-encrypts with its tenant DEK.
 */
export const EncryptedPii = z
  .object({ enc: z.string().min(16).describe('base64 AES-256-GCM envelope (shared integration key)') })
  .describe('encrypted PII');

export const SourcePlatform = z.enum(['getproperty', 'getbuild', 'getpack']);
export type SourcePlatform = z.infer<typeof SourcePlatform>;

export const UnitTypeSchema = z.enum(['room', 'condo_unit', 'house', 'shop', 'parking']);
export const PartyTypeSchema = z.enum(['person', 'company']);

/** A party as carried between platforms (no ID numbers: cross-tenant identity uses LINE ids, §4.7). */
export const PartyPayload = z.object({
  ref: SourceRef,
  type: PartyTypeSchema,
  displayName: z.string().min(1).max(300),
  phone: EncryptedPii.optional(),
  email: EncryptedPii.optional(),
  lineUserId: z.string().min(1).max(100).optional(),
  language: z.string().length(2).optional(),
});
export type PartyPayload = z.infer<typeof PartyPayload>;
