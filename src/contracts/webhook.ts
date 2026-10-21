import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Cross-product webhook transport (D-238, getproperty blueprint task T-16; since 0.4.0): every integration event
 * leaves its producer's outbox as one HTTP `POST <receiver>/webhooks/integration/<sourcePlatform>` over the box's
 * docker network, the JSON envelope as the body, signed with an HMAC-SHA256 key shared by the two products (one key
 * per direction, held in each product's app secret). Every Collective product signs and verifies with these helpers
 * so the wire format exists exactly once.
 *
 * Wire format:
 * - `X-Collective-Event-Id`: the envelope's `idempotencyKey` (receivers dedupe on it; also the HTTP Idempotency-Key)
 * - `X-Collective-Source`: the sending platform (a `SourcePlatform`: `getproperty` | `getbuild` | `getpack`)
 * - `X-Collective-Timestamp`: unix seconds when the request was signed
 * - `X-Collective-Signature`: `v1=<hex HMAC-SHA256(key, "<timestamp>.<raw body>")>`; during a key rotation the
 *   sender may send several comma-separated `v1=` values, the receiver accepts any key it holds
 * Receivers reject a timestamp outside ±`toleranceSeconds` (default 300) and answer 2xx only once the event is
 * stored (the sender retries anything else with backoff; a duplicate answers 2xx again).
 */
export const WEBHOOK_HEADERS = {
  eventId: 'x-collective-event-id',
  source: 'x-collective-source',
  timestamp: 'x-collective-timestamp',
  signature: 'x-collective-signature',
} as const;

export const WEBHOOK_SIGNATURE_VERSION = 'v1';
export const WEBHOOK_DEFAULT_TOLERANCE_SECONDS = 300;

function hmacHex(key: string, timestamp: number, body: string | Buffer): string {
  return createHmac('sha256', key)
    .update(`${timestamp}.`)
    .update(typeof body === 'string' ? Buffer.from(body, 'utf8') : body)
    .digest('hex');
}

/** The headers of one signed request (`keys`: the current key first; more than one only while rotating). */
export function signIntegrationWebhook(input: {
  keys: readonly string[];
  body: string | Buffer;
  eventId: string;
  source: string;
  /** Unix seconds; defaults to now. */
  timestamp?: number;
}): Record<(typeof WEBHOOK_HEADERS)[keyof typeof WEBHOOK_HEADERS], string> {
  if (input.keys.length === 0 || input.keys.some((k) => k.length < 32))
    throw new Error('signIntegrationWebhook: at least one key of ≥ 32 characters is required');
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  return {
    [WEBHOOK_HEADERS.eventId]: input.eventId,
    [WEBHOOK_HEADERS.source]: input.source,
    [WEBHOOK_HEADERS.timestamp]: String(timestamp),
    [WEBHOOK_HEADERS.signature]: input.keys
      .map((k) => `${WEBHOOK_SIGNATURE_VERSION}=${hmacHex(k, timestamp, input.body)}`)
      .join(','),
  };
}

export type WebhookVerification =
  | { ok: true; timestamp: number }
  | { ok: false; reason: 'missing_headers' | 'stale_timestamp' | 'bad_signature' };

/**
 * Verifies a received request against the raw body (never a re-serialised object). `headers` are matched
 * case-insensitively; `keys` are every key the receiver currently accepts for that sender.
 */
export function verifyIntegrationWebhook(input: {
  keys: readonly string[];
  body: string | Buffer;
  headers: Record<string, string | string[] | undefined>;
  /** Unix seconds; defaults to now. */
  now?: number;
  toleranceSeconds?: number;
}): WebhookVerification {
  const header = (name: string): string | undefined => {
    const hit = Object.entries(input.headers).find(([k]) => k.toLowerCase() === name)?.[1];
    return Array.isArray(hit) ? hit[0] : hit;
  };
  const ts = header(WEBHOOK_HEADERS.timestamp);
  const sig = header(WEBHOOK_HEADERS.signature);
  if (!ts || !sig || !/^\d{9,11}$/.test(ts) || input.keys.length === 0)
    return { ok: false, reason: 'missing_headers' };
  const timestamp = Number(ts);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (input.toleranceSeconds ?? WEBHOOK_DEFAULT_TOLERANCE_SECONDS))
    return { ok: false, reason: 'stale_timestamp' };
  const presented = sig
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(`${WEBHOOK_SIGNATURE_VERSION}=`))
    .map((s) => s.slice(WEBHOOK_SIGNATURE_VERSION.length + 1))
    .filter((s) => /^[0-9a-f]{64}$/.test(s))
    .map((s) => Buffer.from(s, 'hex'));
  for (const key of input.keys) {
    const expected = Buffer.from(hmacHex(key, timestamp, input.body), 'hex');
    if (presented.some((p) => p.length === expected.length && timingSafeEqual(p, expected)))
      return { ok: true, timestamp };
  }
  return { ok: false, reason: 'bad_signature' };
}
