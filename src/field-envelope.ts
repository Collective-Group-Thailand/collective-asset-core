import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * Per-tenant field encryption envelope (blueprint rule 5, schema-design v2 §4.7, D-148):
 *   version(1) || kid(2, big-endian) || iv(12) || ciphertext || tag(16)   — AES-256-GCM with the tenant DEK
 * AAD = tenant_id || table || column || row id, so a ciphertext copied to another row, column or tenant does
 * not decrypt. The DEK itself is unwrapped by the app (KMS); this module never sees the KEK.
 */
export const FIELD_ENVELOPE_VERSION = 1;
const HEADER = 1 + 2 + 12;
const TAG = 16;

export interface FieldContext {
  tenantId: string;
  /** Schema-qualified table, e.g. "core.party". */
  table: string;
  column: string;
  rowId: string;
}

function aad(ctx: FieldContext): Buffer {
  return Buffer.from(`${ctx.tenantId}|${ctx.table}|${ctx.column}|${ctx.rowId}`, 'utf8');
}

export function encryptField(plaintext: string, dek: Buffer, kid: number, ctx: FieldContext): Buffer {
  if (dek.length !== 32) throw new RangeError('encryptField: the DEK must be 32 bytes (AES-256)');
  if (!Number.isInteger(kid) || kid < 1 || kid > 32767)
    throw new RangeError('encryptField: kid must be 1..32767');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(aad(ctx));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const header = Buffer.alloc(3);
  header.writeUInt8(FIELD_ENVELOPE_VERSION, 0);
  header.writeUInt16BE(kid, 1);
  return Buffer.concat([header, iv, body, cipher.getAuthTag()]);
}

/** The key id an envelope was encrypted with (to pick the DEK before decrypting). */
export function envelopeKid(envelope: Buffer): number {
  if (envelope.length < HEADER + TAG || envelope.readUInt8(0) !== FIELD_ENVELOPE_VERSION) {
    throw new Error('field envelope: unsupported version or truncated value');
  }
  return envelope.readUInt16BE(1);
}

export function decryptField(envelope: Buffer, dek: Buffer, ctx: FieldContext): string {
  envelopeKid(envelope);
  const iv = envelope.subarray(3, HEADER);
  const body = envelope.subarray(HEADER, envelope.length - TAG);
  const tag = envelope.subarray(envelope.length - TAG);
  const decipher = createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAAD(aad(ctx));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

/**
 * Lookup hash for equality search (`*_hash` columns): HMAC-SHA256(key, scope || normalised value). Use the
 * tenant id as scope for tenant data, '' for tenant-less lookups (user_account.phone_hash for login).
 */
export function lookupHash(key: Buffer, scope: string, normalisedValue: string): Buffer {
  return createHmac('sha256', key).update(`${scope}|${normalisedValue}`, 'utf8').digest();
}
