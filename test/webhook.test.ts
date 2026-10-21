import { describe, expect, it } from 'vitest';

import { signIntegrationWebhook, verifyIntegrationWebhook, WEBHOOK_HEADERS } from '../src/contracts/index.js';

const KEY = 'k'.repeat(40);
const OLD = 'o'.repeat(40);
const body = JSON.stringify({
  type: 'warranty.defect.reported',
  idempotencyKey: 'getproperty:sr:1:reported',
});

describe('integration webhook signing (D-238, 0.4.0)', () => {
  it('signs and verifies the raw body within the tolerance', () => {
    const headers = signIntegrationWebhook({
      keys: [KEY],
      body,
      eventId: 'getproperty:sr:1:reported',
      source: 'getproperty',
      timestamp: 1_800_000_000,
    });
    expect(headers[WEBHOOK_HEADERS.signature]).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(verifyIntegrationWebhook({ keys: [KEY], body, headers, now: 1_800_000_100 })).toEqual({
      ok: true,
      timestamp: 1_800_000_000,
    });
  });

  it('refuses a changed body, a wrong key, a stale timestamp and missing headers', () => {
    const headers = signIntegrationWebhook({
      keys: [KEY],
      body,
      eventId: 'e',
      source: 'getproperty',
      timestamp: 1_800_000_000,
    });
    const at = 1_800_000_010;
    expect(verifyIntegrationWebhook({ keys: [KEY], body: `${body} `, headers, now: at })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verifyIntegrationWebhook({ keys: [OLD], body, headers, now: at }).ok).toBe(false);
    expect(verifyIntegrationWebhook({ keys: [KEY], body, headers, now: 1_800_000_400 })).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    });
    expect(verifyIntegrationWebhook({ keys: [KEY], body, headers: {}, now: at })).toEqual({
      ok: false,
      reason: 'missing_headers',
    });
  });

  it('accepts any held key during a rotation, header names case-insensitively', () => {
    const headers = signIntegrationWebhook({
      keys: [KEY, OLD],
      body,
      eventId: 'e',
      source: 'getbuild',
      timestamp: 1_800_000_000,
    });
    const upper = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toUpperCase(), v]));
    expect(
      verifyIntegrationWebhook({ keys: [OLD], body: Buffer.from(body), headers: upper, now: 1_800_000_000 })
        .ok,
    ).toBe(true);
  });

  it('requires keys of at least 32 characters', () => {
    expect(() =>
      signIntegrationWebhook({ keys: ['short'], body, eventId: 'e', source: 'getproperty' }),
    ).toThrow();
  });
});
