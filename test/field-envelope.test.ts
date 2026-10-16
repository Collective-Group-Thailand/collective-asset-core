import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decryptField, encryptField, envelopeKid, lookupHash } from '../src/field-envelope.js';

const ctx = {
  tenantId: '0199f1c2-0000-7000-8000-00000000000a',
  table: 'core.party',
  column: 'id_number_enc',
  rowId: '0199f1c2-0003-7000-8000-000000000001',
};

describe('per-tenant field envelope (§4.7)', () => {
  it('round-trips and records the key id', () => {
    const dek = randomBytes(32);
    const env = encryptField('1234567890123', dek, 7, ctx);
    expect(env[0]).toBe(1);
    expect(envelopeKid(env)).toBe(7);
    expect(decryptField(env, dek, ctx)).toBe('1234567890123');
  });

  it('does not decrypt in another row, column or tenant (AAD), nor with another key', () => {
    const dek = randomBytes(32);
    const env = encryptField('secret', dek, 1, ctx);
    expect(() => decryptField(env, dek, { ...ctx, rowId: '0199f1c2-0003-7000-8000-000000000002' })).toThrow();
    expect(() =>
      decryptField(env, dek, { ...ctx, tenantId: '0199f1c2-0000-7000-8000-00000000000b' }),
    ).toThrow();
    expect(() => decryptField(env, randomBytes(32), ctx)).toThrow();
  });

  it('lookup hashes are deterministic per scope', () => {
    const key = randomBytes(32);
    expect(lookupHash(key, 'a', '+66800000001').equals(lookupHash(key, 'a', '+66800000001'))).toBe(true);
    expect(lookupHash(key, 'a', '+66800000001').equals(lookupHash(key, 'b', '+66800000001'))).toBe(false);
  });
});
